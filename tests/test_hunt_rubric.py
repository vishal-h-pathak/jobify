"""tests/test_hunt_rubric.py — H2's compiled-rubric static scorer.

Covers the pure `score_posting` scorer (strong/weak match, disqualifier,
gate rejection, determinism), the feedback hook, and the LLM compiler
against a faked `jobify.shared.llm.complete` (no live Anthropic call, no
API credits spent — matching `tests/test_hunt_scorer.py`'s pattern).
Fixture rubric: `tests/fixtures/rubric_alex_quinn.json`, hand-written for
the `profile.example/` persona (Alex Quinn — platform/infra engineer,
Denver, $165k comp floor).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from jobify.hunt import rubric

_FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "rubric_alex_quinn.json"
)


@pytest.fixture
def alex_rubric() -> dict:
    return json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))


def _posting(**overrides) -> dict:
    base = {
        "title": "Senior Platform Engineer",
        "company": "Acme",
        "location": "Remote",
        "remote": True,
        "description": (
            "Own a service end-to-end across a multi-region Kubernetes + "
            "Kafka stack. SLO-driven platform engineering, distributed "
            "systems experience required. Salary: $175,000-$205,000."
        ),
    }
    base.update(overrides)
    return base


# ── score_posting: strong match ─────────────────────────────────────────


def test_strong_match_scores_high_and_hints_tier_1(alex_rubric):
    result = rubric.score_posting(alex_rubric, _posting())
    assert not result.disqualified
    assert result.score > 0.6
    assert result.tier_hint == 1
    assert any("platform_infra_ownership" in r for r in result.reasons)


# ── score_posting: weak match ────────────────────────────────────────────


def test_weak_match_scores_low(alex_rubric):
    posting = _posting(
        title="Marketing Coordinator",
        description="Plan campaigns and coordinate with the events team.",
    )
    result = rubric.score_posting(alex_rubric, posting)
    assert not result.disqualified
    assert result.score == 0.0
    assert result.tier_hint is None
    assert "no term groups matched" in result.reasons


# ── score_posting: regex disqualifier ────────────────────────────────────


def test_disqualifier_regex_short_circuits(alex_rubric):
    posting = _posting(
        title="Senior Platform Engineer, Web3",
        description="Own our crypto trading platform end-to-end.",
    )
    result = rubric.score_posting(alex_rubric, posting)
    assert result.disqualified
    assert result.score == 0.0
    assert result.tier_hint is None
    assert any("disqualified" in r and "Crypto" in r for r in result.reasons)


# ── score_posting: gate rejection ────────────────────────────────────────


def test_location_gate_rejects_onsite_outside_base(alex_rubric):
    posting = _posting(
        location="Austin, TX (on-site only)",
        remote=False,
    )
    result = rubric.score_posting(alex_rubric, posting)
    assert result.disqualified
    assert any("gate:location" in r for r in result.reasons)


def test_comp_gate_rejects_below_floor(alex_rubric):
    posting = _posting(
        description=(
            "Own a service end-to-end across a multi-region Kubernetes + "
            "Kafka stack. Salary: $120,000-$140,000."
        ),
    )
    result = rubric.score_posting(alex_rubric, posting)
    assert result.disqualified
    assert any("gate:comp" in r for r in result.reasons)


def test_comp_gate_skipped_when_unparseable(alex_rubric):
    posting = _posting(description="Own a distributed systems platform. Competitive pay.")
    result = rubric.score_posting(alex_rubric, posting)
    assert not result.disqualified


def test_degree_gate_is_soft_flag_not_disqualifying(alex_rubric):
    posting = _posting(
        description=(
            "Own a distributed systems platform end-to-end. PhD required, "
            "no exceptions."
        ),
    )
    result = rubric.score_posting(alex_rubric, posting)
    assert not result.disqualified
    assert any("degree_gated" in r for r in result.reasons)


def test_degree_with_equivalent_escape_hatch_does_not_flag(alex_rubric):
    posting = _posting(
        description=(
            "Own a distributed systems platform end-to-end. PhD or "
            "equivalent practical experience required."
        ),
    )
    result = rubric.score_posting(alex_rubric, posting)
    assert not any("degree_gated" in r for r in result.reasons)


# ── determinism ───────────────────────────────────────────────────────────


def test_scoring_is_deterministic(alex_rubric):
    posting = _posting()
    first = rubric.score_posting(alex_rubric, posting)
    second = rubric.score_posting(copy.deepcopy(alex_rubric), copy.deepcopy(posting))
    assert first == second


# ── feedback hook ─────────────────────────────────────────────────────────


def test_apply_feedback_boosts_saved_group(alex_rubric):
    before = next(
        g["weight"] for g in alex_rubric["term_groups"]
        if g["group"] == "platform_infra_ownership"
    )
    events = [{"action": "save", "matched_groups": ["platform_infra_ownership"]}]
    updated = rubric.apply_feedback(alex_rubric, events)
    after = next(
        g["weight"] for g in updated["term_groups"]
        if g["group"] == "platform_infra_ownership"
    )
    assert after == pytest.approx(before * rubric.FEEDBACK_SAVE_MULTIPLIER)
    # Input not mutated.
    assert alex_rubric["term_groups"][0]["weight"] == before


def test_apply_feedback_dismiss_lowers_weight_and_is_clamped(alex_rubric):
    events = [
        {"action": "dismiss", "matched_groups": ["generalist_mission"]}
    ] * 200  # enough repeats to hit the floor clamp
    updated = rubric.apply_feedback(alex_rubric, events)
    weight = next(
        g["weight"] for g in updated["term_groups"]
        if g["group"] == "generalist_mission"
    )
    assert weight == pytest.approx(rubric.FEEDBACK_WEIGHT_MIN)


def test_apply_feedback_ignores_unknown_action_and_group(alex_rubric):
    events = [
        {"action": "click", "matched_groups": ["platform_infra_ownership"]},
        {"action": "save", "matched_groups": ["not_a_real_group"]},
    ]
    updated = rubric.apply_feedback(alex_rubric, events)
    assert updated == alex_rubric


def test_needs_recompile_on_volume():
    events = [{"action": "save", "matched_groups": []}] * rubric.NEEDS_RECOMPILE_MIN_EVENTS
    assert rubric.needs_recompile(events)


def test_needs_recompile_on_dismiss_ratio():
    events = (
        [{"action": "dismiss", "matched_groups": []}] * 7
        + [{"action": "save", "matched_groups": []}] * 3
    )
    assert rubric.needs_recompile(events)


def test_needs_recompile_false_for_light_healthy_feedback():
    events = (
        [{"action": "save", "matched_groups": []}] * 5
        + [{"action": "dismiss", "matched_groups": []}] * 1
    )
    assert not rubric.needs_recompile(events)


def test_needs_recompile_false_for_no_events():
    assert not rubric.needs_recompile([])


# ── compiler ────────────────────────────────────────────────────────────


def test_compile_rubric_valid_first_try(monkeypatch, alex_rubric):
    captured = {}

    def fake_complete(*, system, prompt, model, max_tokens):
        captured.update(system=system, prompt=prompt, model=model, max_tokens=max_tokens)
        return json.dumps(alex_rubric)

    monkeypatch.setattr(rubric.llm, "complete", fake_complete)

    result = rubric.compile_rubric(
        thesis="THESIS TEXT", disqualifiers_text="DISQ TEXT", targeting_text="TIERS TEXT"
    )

    assert result == alex_rubric
    assert captured["model"] == rubric.COMPILER_MODEL
    assert "THESIS TEXT" in captured["prompt"]
    assert "DISQ TEXT" in captured["prompt"]
    assert "TIERS TEXT" in captured["prompt"]


def test_compile_rubric_retries_once_on_invalid_then_succeeds(monkeypatch, alex_rubric):
    responses = iter([
        '{"rubric_version": 1}',  # missing required keys
        json.dumps(alex_rubric),
    ])

    def fake_complete(**_kwargs):
        return next(responses)

    monkeypatch.setattr(rubric.llm, "complete", fake_complete)

    result = rubric.compile_rubric(
        thesis="T", disqualifiers_text="D", targeting_text="G"
    )
    assert result == alex_rubric


def test_compile_rubric_raises_after_two_invalid_attempts(monkeypatch):
    def fake_complete(**_kwargs):
        return "not json at all"

    monkeypatch.setattr(rubric.llm, "complete", fake_complete)

    with pytest.raises(ValueError, match="invalid rubric after retry"):
        rubric.compile_rubric(thesis="T", disqualifiers_text="D", targeting_text="G")


def test_compile_rubric_with_usage_returns_rubric_and_real_token_counts(monkeypatch, alex_rubric):
    """H4 Task 3's additive sibling: same compile contract, but returns
    real usage for the caller's budget_ledger row instead of routing
    through the plain `complete()` (which has no usage to report)."""
    captured = {}

    def fake_complete_with_usage(*, system, prompt, model, max_tokens):
        captured.update(system=system, prompt=prompt, model=model, max_tokens=max_tokens)
        return json.dumps(alex_rubric), rubric.llm.CompletionUsage(
            input_tokens=123, output_tokens=45,
        )

    monkeypatch.setattr(rubric.llm, "complete_with_usage", fake_complete_with_usage)

    result, usage = rubric.compile_rubric_with_usage(
        thesis="THESIS TEXT", disqualifiers_text="DISQ TEXT", targeting_text="TIERS TEXT",
    )

    assert result == alex_rubric
    assert usage.input_tokens == 123
    assert usage.output_tokens == 45
    assert captured["model"] == rubric.COMPILER_MODEL
    assert "THESIS TEXT" in captured["prompt"]


def test_compile_rubric_with_usage_sums_tokens_across_retry(monkeypatch, alex_rubric):
    responses = iter([
        ('{"rubric_version": 1}', rubric.llm.CompletionUsage(input_tokens=100, output_tokens=10)),
        (json.dumps(alex_rubric), rubric.llm.CompletionUsage(input_tokens=100, output_tokens=20)),
    ])

    def fake_complete_with_usage(**_kwargs):
        return next(responses)

    monkeypatch.setattr(rubric.llm, "complete_with_usage", fake_complete_with_usage)

    result, usage = rubric.compile_rubric_with_usage(
        thesis="T", disqualifiers_text="D", targeting_text="G",
    )

    assert result == alex_rubric
    assert usage.input_tokens == 200  # both attempts cost real tokens
    assert usage.output_tokens == 30


def test_compile_rubric_with_usage_raises_after_two_invalid_attempts(monkeypatch):
    def fake_complete_with_usage(**_kwargs):
        return "not json at all", rubric.llm.CompletionUsage(input_tokens=10, output_tokens=5)

    monkeypatch.setattr(rubric.llm, "complete_with_usage", fake_complete_with_usage)

    with pytest.raises(ValueError, match="invalid rubric after retry"):
        rubric.compile_rubric_with_usage(thesis="T", disqualifiers_text="D", targeting_text="G")


def test_compile_rubric_still_uses_plain_complete_unaffected_by_new_sibling(monkeypatch, alex_rubric):
    """`compile_rubric` itself is untouched: it must keep calling
    `llm.complete` (not `complete_with_usage`), so existing callers/tests
    that only monkeypatch `complete` keep working."""
    def _boom_with_usage(**_kwargs):
        raise AssertionError("compile_rubric must not call complete_with_usage")

    monkeypatch.setattr(rubric.llm, "complete_with_usage", _boom_with_usage)
    monkeypatch.setattr(rubric.llm, "complete", lambda **_kwargs: json.dumps(alex_rubric))

    result = rubric.compile_rubric(thesis="T", disqualifiers_text="D", targeting_text="G")

    assert result == alex_rubric


def test_validate_rubric_reports_bad_regex():
    bad = {
        "rubric_version": 1,
        "term_groups": [{"group": "a", "weight": 1.0, "terms": ["x"]}],
        "disqualifiers": [{"pattern": "(unclosed", "reason": "r"}],
        "gates": {},
        "tier_hints": [],
    }
    errors = rubric.validate_rubric(bad)
    assert any("invalid regex" in e for e in errors)
