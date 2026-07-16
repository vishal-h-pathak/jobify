"""tests/test_hosted_learning.py — jobify.hosted.learning (LIV-1).

The incremental feedback learning pass: watermark-gated event collection
from `posting_reactions` + `matches`, matched-group recovery via the pure
rubric scorer, reweight-vs-recompile branching, and the append-only
`learned-insights.md` insight line. Fakes throughout (DB helpers
monkeypatched directly, no live Supabase, no live LLM) — mirrors
`tests/test_hosted_fanout.py`'s conventions (Task 3 module's own docstring).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from jobify import db
from jobify.hosted import learning
from jobify.hunt import rubric as rubric_module
from jobify.shared.llm import CompletionUsage

# ── fixture builders ───────────────────────────────────────────────────────


def _rubric(groups: list[tuple[str, float, list[str]]] | None = None) -> dict:
    if groups is None:
        groups = [("core", 1.0, ["engineer"])]
    return {
        "rubric_version": 1,
        "term_groups": [
            {"group": name, "weight": weight, "terms": terms}
            for name, weight, terms in groups
        ],
        "disqualifiers": [],
        "gates": {},
        "tier_hints": [],
    }


def _posting(pid: str, title: str = "Some Title", description: str = "", **kw) -> dict:
    return {"id": pid, "title": title, "description": description, "location": "Remote", **kw}


def _wrap_apply_feedback(monkeypatch, captured: list[dict]):
    """Patch `rubric_module.apply_feedback` to record every event passed
    to it while still delegating to the real implementation (so the
    resulting rubric — and therefore the insight-line math — is real)."""
    real = rubric_module.apply_feedback

    def _spy(rubric, events):
        events = list(events)
        captured.extend(events)
        return real(rubric, events)

    monkeypatch.setattr(rubric_module, "apply_feedback", _spy)


# ── 1. No compiled rubric -> early return ────────────────────────────────


def test_no_compiled_rubric_short_circuits(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: None)

    def _boom(*a, **kw):
        raise AssertionError("should never be called when there's no rubric yet")

    monkeypatch.setattr(db, "get_posting_reactions", _boom)
    monkeypatch.setattr(db, "get_matches_by_states", _boom)

    learning.run_learning_pass("user-a", tmp_path)  # must not raise


# ── 2. Watermark incrementality ──────────────────────────────────────────


def test_watermark_incrementality_only_processes_newer_rows(tmp_path, monkeypatch):
    (tmp_path / "learned-insights.md").write_text(
        "<!-- last-processed: 2026-07-10T00:00:00Z -->\n- 2026-07-09: some prior line\n",
        encoding="utf-8",
    )
    rubric = _rubric()
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)
    monkeypatch.setattr(db, "get_posting_reactions", lambda uid: [
        {"posting_id": "p-old", "reaction": "interested", "created_at": "2026-07-09T00:00:00Z"},
        {"posting_id": "p-new", "reaction": "interested", "created_at": "2026-07-11T00:00:00Z"},
    ])
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: [
        {"posting_id": "p-old-2", "state": "dismissed", "state_changed_at": "2026-07-10T00:00:00Z"},
        {"posting_id": "p-new-2", "state": "dismissed", "state_changed_at": "2026-07-12T00:00:00Z"},
    ])
    monkeypatch.setattr(
        db, "get_postings_by_ids",
        lambda ids: [_posting(i, description="engineer text") for i in ids],
    )
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: None)
    monkeypatch.setattr(db, "update_profile_doc_file", lambda uid, fname, content: None)

    captured: list[dict] = []
    _wrap_apply_feedback(monkeypatch, captured)

    learning.run_learning_pass("user-a", tmp_path)

    # Only "p-new" (reaction, ts > watermark) and "p-new-2" (match, ts >
    # watermark) qualify; the two rows at/before the watermark are excluded.
    assert len(captured) == 2


# ── 3. No watermark (fresh file) processes everything ────────────────────


def test_no_watermark_processes_every_existing_row(tmp_path, monkeypatch):
    (tmp_path / "learned-insights.md").write_text("", encoding="utf-8")
    rubric = _rubric()
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)
    monkeypatch.setattr(db, "get_posting_reactions", lambda uid: [
        {"posting_id": "p-1", "reaction": "interested", "created_at": "2020-01-01T00:00:00Z"},
    ])
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: [
        {"posting_id": "p-2", "state": "saved", "state_changed_at": "2020-01-02T00:00:00Z"},
        {"posting_id": "p-3", "state": "dismissed", "state_changed_at": "2020-01-03T00:00:00Z"},
    ])
    monkeypatch.setattr(
        db, "get_postings_by_ids",
        lambda ids: [_posting(i, description="engineer text") for i in ids],
    )
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: None)
    monkeypatch.setattr(db, "update_profile_doc_file", lambda uid, fname, content: None)

    captured: list[dict] = []
    _wrap_apply_feedback(monkeypatch, captured)

    learning.run_learning_pass("user-a", tmp_path)

    assert len(captured) == 3  # every row that exists, no watermark to gate against


# ── 4. Matched-groups recovery ───────────────────────────────────────────


def test_matched_groups_recovers_only_the_hit_group(tmp_path, monkeypatch):
    (tmp_path / "learned-insights.md").write_text("", encoding="utf-8")
    rubric = _rubric(groups=[
        ("core", 1.0, ["unique_engineer_term"]),
        ("other", 1.0, ["unrelated_sales_term"]),
    ])
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)
    monkeypatch.setattr(db, "get_posting_reactions", lambda uid: [
        {"posting_id": "p-1", "reaction": "interested", "created_at": "2020-01-01T00:00:00Z"},
    ])
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: [])
    monkeypatch.setattr(
        db, "get_postings_by_ids",
        lambda ids: [_posting("p-1", description="a posting about the unique_engineer_term role")],
    )
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: None)
    monkeypatch.setattr(db, "update_profile_doc_file", lambda uid, fname, content: None)

    captured: list[dict] = []
    _wrap_apply_feedback(monkeypatch, captured)

    learning.run_learning_pass("user-a", tmp_path)

    assert len(captured) == 1
    assert captured[0]["matched_groups"] == ["core"]
    assert "other" not in captured[0]["matched_groups"]


def test_scoring_failure_on_one_posting_does_not_drop_the_batch(tmp_path, monkeypatch, caplog):
    """A malformed posting that makes `score_posting` raise must not sink
    the whole event batch — the offending posting falls back to
    `matched_groups: []` (same shape as "posting not found") and every
    other event in the batch still gets processed."""
    (tmp_path / "learned-insights.md").write_text("", encoding="utf-8")
    rubric = _rubric(groups=[("core", 1.0, ["unique_engineer_term"])])
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)
    monkeypatch.setattr(db, "get_posting_reactions", lambda uid: [
        {"posting_id": "p-bad", "reaction": "interested", "created_at": "2020-01-01T00:00:00Z"},
        {"posting_id": "p-good", "reaction": "interested", "created_at": "2020-01-01T00:00:01Z"},
    ])
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: [])
    monkeypatch.setattr(
        db, "get_postings_by_ids",
        lambda ids: [
            _posting("p-bad", description="a posting about the unique_engineer_term role"),
            _posting("p-good", description="a posting about the unique_engineer_term role"),
        ],
    )
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: None)
    monkeypatch.setattr(db, "update_profile_doc_file", lambda uid, fname, content: None)

    real_score_posting = rubric_module.score_posting

    def _flaky_score_posting(rubric, posting):
        if posting["id"] == "p-bad":
            raise ValueError("malformed posting")
        return real_score_posting(rubric, posting)

    monkeypatch.setattr(rubric_module, "score_posting", _flaky_score_posting)

    captured: list[dict] = []
    _wrap_apply_feedback(monkeypatch, captured)

    with caplog.at_level("WARNING", logger="jobify.hosted.learning"):
        learning.run_learning_pass("user-a", tmp_path)

    assert len(captured) == 2  # the whole batch survived, not just the good posting
    by_action_order = captured
    assert by_action_order[0]["matched_groups"] == []  # p-bad: scoring raised, fell back to []
    assert by_action_order[1]["matched_groups"] == ["core"]  # p-good: scored normally
    assert "p-bad" in caplog.text


# ── 5. Reweight persisted ────────────────────────────────────────────────


def test_reweight_persisted_reflects_apply_feedback_multiplier(tmp_path, monkeypatch):
    (tmp_path / "learned-insights.md").write_text("", encoding="utf-8")
    rubric = _rubric(groups=[("core", 1.0, ["engineer"])])
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)
    monkeypatch.setattr(db, "get_posting_reactions", lambda uid: [
        {"posting_id": "p-1", "reaction": "interested", "created_at": "2020-01-01T00:00:00Z"},
    ])
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: [])
    monkeypatch.setattr(
        db, "get_postings_by_ids",
        lambda ids: [_posting("p-1", description="engineer role")],
    )
    monkeypatch.setattr(db, "update_profile_doc_file", lambda uid, fname, content: None)

    set_calls: list[dict] = []
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: set_calls.append(r))

    learning.run_learning_pass("user-a", tmp_path)  # real apply_feedback, not mocked

    assert len(set_calls) == 1
    new_weight = set_calls[0]["term_groups"][0]["weight"]
    assert new_weight == pytest.approx(1.0 * rubric_module.FEEDBACK_SAVE_MULTIPLIER)


# ── 6. Recompile fires at threshold with exactly one ledger row ─────────


def test_recompile_fires_at_event_threshold(tmp_path, monkeypatch):
    (tmp_path / "learned-insights.md").write_text("", encoding="utf-8")
    rubric = _rubric()
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)
    monkeypatch.setattr(db, "get_posting_reactions", lambda uid: [
        {
            "posting_id": f"p-{i}", "reaction": "interested",
            "created_at": f"2020-01-01T00:00:{i:02d}Z",
        }
        for i in range(rubric_module.NEEDS_RECOMPILE_MIN_EVENTS)
    ])
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: [])
    monkeypatch.setattr(
        db, "get_postings_by_ids",
        lambda ids: [_posting(i, description="engineer role") for i in ids],
    )
    monkeypatch.setattr(db, "update_profile_doc_file", lambda uid, fname, content: None)

    set_calls: list[dict] = []
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: set_calls.append(r))

    apply_feedback_calls: list[object] = []
    monkeypatch.setattr(
        rubric_module, "apply_feedback",
        lambda rubric, events: apply_feedback_calls.append(1) or rubric,
    )

    canned_rubric = _rubric(groups=[("recompiled", 2.0, ["fresh"])])
    compile_calls: list[dict] = []

    def _fake_compile(*, thesis, disqualifiers_text, targeting_text):
        compile_calls.append({
            "thesis": thesis, "disqualifiers_text": disqualifiers_text,
            "targeting_text": targeting_text,
        })
        return canned_rubric, CompletionUsage(input_tokens=100, output_tokens=50)

    monkeypatch.setattr(rubric_module, "compile_rubric_with_usage", _fake_compile)

    ledger_calls: list[tuple] = []
    monkeypatch.setattr(
        db, "insert_budget_ledger_row",
        lambda uid, event, **kw: ledger_calls.append((event, kw)),
    )

    learning.run_learning_pass("user-a", tmp_path)

    assert len(compile_calls) == 1
    assert len(ledger_calls) == 1
    assert ledger_calls[0][0] == "rubric_recompile"
    assert len(apply_feedback_calls) == 0  # incremental path NOT also taken
    assert len(set_calls) == 1
    assert set_calls[0] == canned_rubric  # the recompiled data, not a reweighted one


# ── 7. Append-only insights + >5%-delta reporting ────────────────────────


def test_insights_are_append_only_across_two_passes(tmp_path, monkeypatch):
    (tmp_path / "learned-insights.md").write_text("", encoding="utf-8")

    state = {"rubric": _rubric(groups=[
        ("core", 1.0, ["widget"]),
        ("other", 1.0, ["gadget"]),
    ])}
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: state["rubric"])
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: state.__setitem__("rubric", r))
    monkeypatch.setattr(db, "update_profile_doc_file", lambda uid, fname, content: None)

    postings_map = {
        "p1": _posting("p1", description="widget role"),
        "p2": _posting("p2", description="widget role"),
        "p3": _posting("p3", description="gadget role"),
        "p4": _posting("p4", description="gadget role"),
    }
    monkeypatch.setattr(
        db, "get_postings_by_ids",
        lambda ids: [postings_map[i] for i in ids if i in postings_map],
    )
    monkeypatch.setattr(db, "get_posting_reactions", lambda uid: [])

    current_matches = [
        {"posting_id": "p1", "state": "saved", "state_changed_at": "2020-01-01T00:00:00Z"},
        {"posting_id": "p2", "state": "saved", "state_changed_at": "2020-01-01T00:00:01Z"},
    ]
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: current_matches)

    learning.run_learning_pass("user-a", tmp_path)

    content_after_first = (tmp_path / "learned-insights.md").read_text(encoding="utf-8")
    lines_after_first = [l for l in content_after_first.split("\n") if l.startswith("- ")]
    assert len(lines_after_first) == 1
    first_line = lines_after_first[0]
    assert "core" in first_line

    # Second pass: a fresh batch, newer than the watermark the first pass wrote.
    current_matches[:] = [
        {"posting_id": "p3", "state": "saved", "state_changed_at": "2020-01-05T00:00:00Z"},
        {"posting_id": "p4", "state": "saved", "state_changed_at": "2020-01-05T00:00:01Z"},
    ]

    learning.run_learning_pass("user-a", tmp_path)

    content_after_second = (tmp_path / "learned-insights.md").read_text(encoding="utf-8")
    assert first_line in content_after_second  # verbatim, byte-level substring
    lines_after_second = [l for l in content_after_second.split("\n") if l.startswith("- ")]
    assert len(lines_after_second) == 2
    assert "other" in lines_after_second[1]


# ── 8. Sub-threshold reweight still persists, no insight line ───────────


def test_sub_threshold_reweight_persists_without_insight_line(tmp_path, monkeypatch):
    """A lone save event always nudges a group's weight by ~+/-5%
    (`FEEDBACK_SAVE_MULTIPLIER`), which floating-point rounding pushes
    *just* over `INSIGHT_DELTA_THRESHOLD` — not a genuine sub-threshold
    case. To get a delta that's actually below 5%, start the group's
    weight close enough to `FEEDBACK_WEIGHT_MAX` that the clamp caps the
    nudge short of a full 5% move."""
    (tmp_path / "learned-insights.md").write_text(
        "<!-- last-processed: 2020-01-01T00:00:00Z -->\n", encoding="utf-8",
    )
    starting_weight = rubric_module.FEEDBACK_WEIGHT_MAX - 0.2  # clamp caps the nudge below 5%
    rubric = _rubric(groups=[("core", starting_weight, ["engineer"])])
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)
    monkeypatch.setattr(db, "get_posting_reactions", lambda uid: [])
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: [
        {"posting_id": "p-1", "state": "saved", "state_changed_at": "2020-01-02T00:00:00Z"},
    ])
    monkeypatch.setattr(
        db, "get_postings_by_ids",
        lambda ids: [_posting("p-1", description="engineer role")],
    )
    monkeypatch.setattr(db, "update_profile_doc_file", lambda uid, fname, content: None)

    set_calls: list[dict] = []
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: set_calls.append(r))

    before_lines = [
        l for l in (tmp_path / "learned-insights.md").read_text(encoding="utf-8").split("\n")
        if l.startswith("- ")
    ]

    learning.run_learning_pass("user-a", tmp_path)  # single save event, clamped below 5%

    assert len(set_calls) == 1  # the reweight always persists...
    new_weight = set_calls[0]["term_groups"][0]["weight"]
    assert new_weight == pytest.approx(rubric_module.FEEDBACK_WEIGHT_MAX)  # clamped, not a full 5%

    after_content = (tmp_path / "learned-insights.md").read_text(encoding="utf-8")
    after_lines = [l for l in after_content.split("\n") if l.startswith("- ")]
    assert after_lines == before_lines == []  # ...but no new dated bullet line
    assert "last-processed: 2020-01-02T00:00:00Z" in after_content  # watermark did move


# ── 9. Failure isolation ──────────────────────────────────────────────────


def test_failure_in_inner_step_never_propagates(tmp_path, monkeypatch):
    (tmp_path / "learned-insights.md").write_text("", encoding="utf-8")
    rubric = _rubric()
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)

    def _boom(uid):
        raise RuntimeError("simulated Supabase failure")

    monkeypatch.setattr(db, "get_posting_reactions", _boom)
    monkeypatch.setattr(db, "get_matches_by_states", lambda uid, states: [])

    set_calls: list[object] = []
    doc_calls: list[object] = []
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, r: set_calls.append(r))
    monkeypatch.setattr(
        db, "update_profile_doc_file",
        lambda uid, fname, content: doc_calls.append(content),
    )

    learning.run_learning_pass("user-a", tmp_path)  # must not raise

    assert set_calls == []
    assert doc_calls == []


# ── 10. Action mapping ────────────────────────────────────────────────────


def test_event_action_mapping():
    assert learning._event_action(source="reaction", value="interested") == "save"
    assert learning._event_action(source="reaction", value="not_interested") == "dismiss"
    assert learning._event_action(source="reaction", value="something_else") is None
    assert learning._event_action(source="match", value="saved") == "save"
    assert learning._event_action(source="match", value="applied") == "save"
    assert learning._event_action(source="match", value="dismissed") == "dismiss"
    assert learning._event_action(source="match", value="new") is None
    assert learning._event_action(source="match", value="seen") is None
