"""tests/test_hosted_fanout.py — jobify.hosted.fanout (H4 Task 3).

The per-user scoring ladder: title pre-filter -> compiled rubric ->
embedding rerank -> budget-gated LLM verdict for the top-N survivors.
Fakes throughout (DB helpers monkeypatched directly, LLM/embedding calls
faked) — no network, matching `tests/test_hosted_discovery.py` and
`tests/test_hosted_embed.py`'s conventions (Task 2).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from jobify import db
from jobify.hosted import embed, fanout
from jobify.shared import llm
from jobify.shared.llm import CompletionUsage

# ── fixture builders ───────────────────────────────────────────────────────

_DEFAULT_PROFILE_YAML = """
what_he_is_looking_for:
  tier_1:
    label: Platform engineering
    notes: Own services end to end.
"""


def _profile_dir(
    tmp_path: Path,
    name: str,
    *,
    thesis: str = "Wants platform engineering roles.",
    portals_yaml: str = "",
    profile_yaml: str = _DEFAULT_PROFILE_YAML,
    disqualifiers_yaml: str = "",
) -> Path:
    d = tmp_path / name
    d.mkdir()
    (d / "thesis.md").write_text(thesis, encoding="utf-8")
    (d / "portals.yml").write_text(portals_yaml, encoding="utf-8")
    (d / "profile.yml").write_text(profile_yaml, encoding="utf-8")
    (d / "disqualifiers.yml").write_text(disqualifiers_yaml, encoding="utf-8")
    return d


def _rubric(term: str = "engineer", weight: float = 1.0, disqualifiers=None) -> dict:
    return {
        "rubric_version": 1,
        "term_groups": [{"group": "core", "weight": weight, "terms": [term]}],
        "disqualifiers": disqualifiers or [],
        "gates": {},
        "tier_hints": [],
    }


def _posting(pid: str, title: str = "Platform Engineer",
             description: str = "Own services end to end.", **kw) -> dict:
    return {
        "id": pid, "title": title, "company": "Acme", "location": "Remote",
        "description": description, **kw,
    }


@pytest.fixture(autouse=True)
def _no_embeddings_by_default(monkeypatch):
    """Most tests aren't about stage 3 — keep it off by default so
    embed_score stays cleanly NULL and assertions on stage 2 / 4 aren't
    muddied. Individual stage-3 tests re-enable it explicitly."""
    monkeypatch.setattr(embed, "embeddings_enabled", lambda: False)


@pytest.fixture(autouse=True)
def _no_llm_by_default(monkeypatch):
    """Fail loudly if any test reaches a real LLM call it didn't set up
    a fake for — never a live Anthropic call in this suite."""
    def _boom(**kwargs):
        raise AssertionError(f"unexpected llm.complete_with_usage call: {kwargs}")
    monkeypatch.setattr(llm, "complete_with_usage", _boom)


@pytest.fixture(autouse=True)
def _no_global_cap_by_default(monkeypatch):
    """Most tests aren't about the H6 global pool cap — keep reported
    global spend at $0 so `fanout._global_cap_exceeded()` is always False
    unless a test explicitly raises it. Individual global-cap tests
    override this directly."""
    monkeypatch.setattr(db, "get_global_month_to_date_spend", lambda: 0.0)


@pytest.fixture(autouse=True)
def _no_byo_key_by_default(monkeypatch):
    """Most tests aren't about H6 BYO keys — no user has an `api_keys`
    row unless a test explicitly fakes one."""
    monkeypatch.setattr(db, "get_api_key_ciphertext", lambda uid: None)


def _fixed_verdict_llm(monkeypatch, score: float = 0.7, reason: str = "good fit"):
    """Every stage-4 call (any model) returns the same canned verdict."""
    calls: list[dict] = []

    def _fake(*, system, prompt, model, max_tokens):
        calls.append({"system": system, "prompt": prompt, "model": model, "max_tokens": max_tokens})
        return (
            json.dumps({"score": score, "reason": reason}),
            CompletionUsage(input_tokens=100, output_tokens=20),
        )

    monkeypatch.setattr(llm, "complete_with_usage", _fake)
    return calls


# ── Stage 1: title pre-filter ────────────────────────────────────────────


def test_stage1_title_filter_failure_gets_no_matches_row(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a", portals_yaml=(
        "title_filter:\n  reject_substrings: ['intern']\n"
    ))
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)

    postings = [_posting("p-intern", title="Engineering Intern"), _posting("p-real")]
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: postings)

    _fixed_verdict_llm(monkeypatch)
    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((pid, kw)))

    counters = fanout.run_fanout_cycle(["user-a"])

    written_ids = {pid for pid, _kw in upserts}
    assert written_ids == {"p-real"}
    assert counters["postings_scored"] == 1  # only the survivor reached stage 2


# ── Stage 2: compiled rubric ─────────────────────────────────────────────


def test_stage2_hard_disqualify_gets_no_matches_row(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(
        db, "get_compiled_rubric",
        lambda uid: _rubric(disqualifiers=[{"pattern": "(?i)crypto", "reason": "not interested"}]),
    )
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)

    postings = [
        _posting("p-crypto", title="Crypto Engineer", description="Blockchain, crypto, web3."),
        _posting("p-real"),
    ]
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: postings)

    _fixed_verdict_llm(monkeypatch)
    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((pid, kw)))

    fanout.run_fanout_cycle(["user-a"])

    written_ids = {pid for pid, _kw in upserts}
    assert written_ids == {"p-real"}, "a hard-disqualified posting must get NO matches row"


def test_stage2_writes_rubric_score_and_reason(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric(term="engineer", weight=1.0))
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])

    _fixed_verdict_llm(monkeypatch, score=0.7, reason="good fit")
    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((pid, kw)))

    fanout.run_fanout_cycle(["user-a"])

    # Two writes for p-1: stage-2 (rubric) then stage-4 (llm) overwrite.
    stage2_write = next(kw for pid, kw in upserts if pid == "p-1" and kw.get("reason_source") == "rubric")
    assert stage2_write["rubric_score"] == 1.0
    assert stage2_write["embed_score"] is None
    assert "matched:core" in stage2_write["reason"]


# ── Ladder ordering: stage 4 only touches the top-N ──────────────────────


def test_ladder_ordering_stage4_only_scores_top_n(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    monkeypatch.setattr(fanout, "HOSTED_STAGE4_TOP_N", 1)

    # Three term groups of different weight so postings that match more
    # groups score strictly higher — a real, non-tied ranking.
    rubric = {
        "rubric_version": 1,
        "term_groups": [
            {"group": "a", "weight": 3.0, "terms": ["platform"]},
            {"group": "b", "weight": 2.0, "terms": ["kubernetes"]},
            {"group": "c", "weight": 1.0, "terms": ["engineer"]},
        ],
        "disqualifiers": [], "gates": {}, "tier_hints": [],
    }
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: rubric)

    # Neutral titles (no group terms) so only `description` drives the
    # per-group match — a title of "Platform Engineer" would otherwise
    # silently satisfy groups "a"/"c" for every posting regardless of body.
    postings = [
        _posting("best", title="Senior Role", description="platform kubernetes engineer role"),  # 6/6 = 1.0
        _posting("mid", title="Senior Role", description="kubernetes engineer role"),             # 3/6 = 0.5
        _posting("low", title="Senior Role", description="engineer role"),                        # 1/6 ~= 0.167
    ]
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: postings)

    calls = _fixed_verdict_llm(monkeypatch)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["stage4_calls"] == 1
    assert len(calls) == 1
    assert "platform kubernetes engineer role" in calls[0]["prompt"]


# ── Budget stop ────────────────────────────────────────────────────────


def test_budget_stop_skips_stage4_but_stages_1_3_still_ran(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 5.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 5.0)  # at cap

    ledger_calls: list[tuple] = []
    monkeypatch.setattr(
        db, "insert_budget_ledger_row",
        lambda user_id, event, **kw: ledger_calls.append((user_id, event)),
    )
    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((pid, kw)))

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["users_budget_stopped"] == 1
    assert counters["stage4_calls"] == 0
    assert not any(event == "llm_verdict" for _uid, event in ledger_calls)
    # Stages 1-3 still ran: the rubric_score is on the row.
    assert len(upserts) == 1
    pid, kw = upserts[0]
    assert pid == "p-1"
    assert kw["rubric_score"] == 1.0
    assert kw["reason_source"] == "rubric"


# ── Invalid profile -> skipped entirely ──────────────────────────────────


def test_invalid_profile_is_skipped_entirely(monkeypatch):
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "invalid")

    def _boom_materialize(uid):
        raise AssertionError("must not materialize an invalid user's profile")
    monkeypatch.setattr(fanout, "materialize_profile_dir", _boom_materialize)

    def _boom_db(*a, **kw):
        raise AssertionError("must not touch matches/ledger for an invalid user")
    monkeypatch.setattr(db, "upsert_match", _boom_db)
    monkeypatch.setattr(db, "insert_budget_ledger_row", _boom_db)
    monkeypatch.setattr(db, "get_unmatched_postings", _boom_db)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["users_skipped_invalid"] == 1
    assert counters["users_processed"] == 0


def test_never_validated_profile_proceeds_fail_open(tmp_path, monkeypatch):
    """`None` (never materialized/validated) is NOT 'invalid' — proceed."""
    d = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: None)
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    _fixed_verdict_llm(monkeypatch)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["users_skipped_invalid"] == 0
    assert counters["users_processed"] == 1


# ── State preservation on re-score ───────────────────────────────────────


def test_upsert_match_calls_never_touch_state_columns(tmp_path, monkeypatch):
    """Stage 2 writes a row, stage 4 upserts the SAME (user, posting) pair
    again in the same cycle. Neither write may ever pass `state` /
    `state_changed_at` — `db.upsert_match`'s contract (see
    `tests/test_db_hosted.py`) relies on the caller never including those
    keys so a real Postgrest upsert leaves an already-triaged row's state
    untouched on conflict."""
    d = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    _fixed_verdict_llm(monkeypatch)

    upserts: list[dict] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append(kw))

    fanout.run_fanout_cycle(["user-a"])

    assert len(upserts) == 2  # stage-2 write + stage-4 overwrite
    for kw in upserts:
        assert "state" not in kw
        assert "state_changed_at" not in kw


# ── Stage 3: embedding rerank ────────────────────────────────────────────


class _FakeVoyageClient:
    def __init__(self, vectors: dict[str, list[float]]):
        self._vectors = vectors

    def embed(self, texts, model, input_type, output_dimension):
        class _Result:
            def __init__(self, embeddings):
                self.embeddings = embeddings
                self.total_tokens = 10

        out = []
        for t in texts:
            for key, vec in self._vectors.items():
                if key in t:
                    out.append(vec)
                    break
            else:
                out.append([0.0, 0.0])
        return _Result(out)


def test_stage3_embedding_rerank_drives_top_n_selection(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a", thesis="PROFILE_MARKER thesis text")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    # Equal rubric scores -> ranking must come from embed_score alone.
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric(term="engineer"))
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    monkeypatch.setattr(fanout, "HOSTED_STAGE4_TOP_N", 1)

    postings = [
        _posting("aligned", description="engineer ALIGNED_MARKER"),
        _posting("orthogonal", description="engineer ORTHOGONAL_MARKER"),
    ]
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: postings)

    monkeypatch.setattr(embed, "embeddings_enabled", lambda: True)
    fake_client = _FakeVoyageClient({
        "PROFILE_MARKER": [1.0, 0.0],
        "ALIGNED_MARKER": [1.0, 0.0],       # cos(profile, aligned) = 1.0
        "ORTHOGONAL_MARKER": [0.0, 1.0],    # cos(profile, orthogonal) = 0.0
    })
    monkeypatch.setattr(embed, "_get_client", lambda: fake_client)
    monkeypatch.setattr(embed, "_client", None)

    profile_store: dict[str, list[float]] = {}
    posting_store: dict[str, list[float]] = {}
    monkeypatch.setattr(db, "get_profile_embedding", lambda uid: profile_store.get(uid))
    monkeypatch.setattr(db, "set_profile_embedding", lambda uid, vec: profile_store.__setitem__(uid, vec))
    monkeypatch.setattr(db, "get_posting_embedding", lambda pid: posting_store.get(pid))
    monkeypatch.setattr(db, "set_posting_embedding", lambda pid, vec: posting_store.__setitem__(pid, vec))

    calls = _fixed_verdict_llm(monkeypatch)
    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((pid, kw)))

    counters = fanout.run_fanout_cycle(["user-a"])

    stage2_rows = {pid: kw for pid, kw in upserts if kw.get("reason_source") == "rubric"}
    assert stage2_rows["aligned"]["embed_score"] == pytest.approx(1.0)
    assert stage2_rows["orthogonal"]["embed_score"] == pytest.approx(0.0)
    # Top-N=1 by composite (rubric tied, embed decides) picks "aligned" only.
    assert counters["stage4_calls"] == 1
    assert "ALIGNED_MARKER" in calls[0]["prompt"]
    assert "ORTHOGONAL_MARKER" not in calls[0]["prompt"]


def test_stage3_skipped_when_embeddings_disabled_ladder_still_completes(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)

    def _boom(*a, **kw):
        raise AssertionError("must not touch embeddings while disabled")
    monkeypatch.setattr(embed, "ensure_profile_embedding", _boom)
    monkeypatch.setattr(embed, "ensure_posting_embedding", _boom)

    _fixed_verdict_llm(monkeypatch)
    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((pid, kw)))

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["stage4_calls"] == 1
    stage2_row = next(kw for pid, kw in upserts if kw.get("reason_source") == "rubric")
    assert stage2_row["embed_score"] is None


# ── Stage 3: profile-embedding recompute-on-change (review follow-up) ────
#
# `embed.ensure_profile_embedding` only recomputes when `fanout.py` passes
# `force=True`; `fanout.py` decides that by comparing the profile's
# materialized `updated_at` stamp (`.materialized_updated_at`, written by
# `profile_loader.materialize_profile_dir`) against its own sibling
# `.embedding_stamp` bookkeeping file. These two tests drive that decision
# directly through two fan-out cycles for the same on-disk profile dir,
# without touching `jobify.db` or the real Voyage client.


def _setup_embedding_recompute_test(tmp_path, monkeypatch, d: Path):
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)
    _fixed_verdict_llm(monkeypatch)

    monkeypatch.setattr(embed, "embeddings_enabled", lambda: True)
    profile_store: dict[str, list[float]] = {}
    force_calls: list[bool] = []

    def _fake_ensure_profile_embedding(user_id, text, *, force=False):
        force_calls.append(force)
        profile_store[user_id] = [1.0, 0.0]
        return True  # always "recomputed" when called, so `force_calls` isolates our own decision
    monkeypatch.setattr(embed, "ensure_profile_embedding", _fake_ensure_profile_embedding)
    monkeypatch.setattr(db, "get_profile_embedding", lambda uid: profile_store.get(uid))
    monkeypatch.setattr(embed, "ensure_posting_embedding", lambda pid, text: True)
    monkeypatch.setattr(db, "get_posting_embedding", lambda pid: [1.0, 0.0])
    monkeypatch.setattr(db, "set_posting_embedding", lambda pid, vec: None)

    return force_calls


def test_embedding_recompute_skipped_when_profile_unchanged(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a")
    (d / ".materialized_updated_at").write_text("2026-01-01T00:00:00Z", encoding="utf-8")
    force_calls = _setup_embedding_recompute_test(tmp_path, monkeypatch, d)

    fanout.run_fanout_cycle(["user-a"])
    fanout.run_fanout_cycle(["user-a"])

    assert force_calls == [True, False], (
        "unchanged profiles.updated_at across cycles must not re-force the embedding"
    )


def test_embedding_recompute_triggered_when_profile_updated_at_changes(tmp_path, monkeypatch):
    d = _profile_dir(tmp_path, "user-a")
    (d / ".materialized_updated_at").write_text("2026-01-01T00:00:00Z", encoding="utf-8")
    force_calls = _setup_embedding_recompute_test(tmp_path, monkeypatch, d)

    fanout.run_fanout_cycle(["user-a"])
    (d / ".materialized_updated_at").write_text("2026-02-02T00:00:00Z", encoding="utf-8")
    fanout.run_fanout_cycle(["user-a"])

    assert force_calls == [True, True], (
        "a changed profiles.updated_at must force a fresh embedding on the next cycle"
    )


# ── Fan-out isolation (the headline regression test) ─────────────────────


def test_stage4_never_leaks_profile_across_users(tmp_path, monkeypatch):
    """Two users, two different theses, materialized in ONE process. Each
    user's stage-4 verdict must reflect ONLY their own thesis — proving
    the purpose-built stage-4 prompt (built fresh per call from an
    explicit `profile_dir`, never a process-global cache) doesn't leak
    one user's profile text into another's call."""
    dir_a = _profile_dir(tmp_path, "user-a", thesis="USER_A_THESIS_MARKER: wants platform engineering.")
    dir_b = _profile_dir(tmp_path, "user-b", thesis="USER_B_THESIS_MARKER: wants data science roles.")
    monkeypatch.setattr(
        fanout, "materialize_profile_dir",
        lambda uid: {"user-a": dir_a, "user-b": dir_b}[uid],
    )
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)

    # Same shared posting pool for both users (mirrors the real shared
    # `postings` table — both users are scoring the SAME row).
    shared_posting = _posting("shared-1", title="Platform Engineer")
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [dict(shared_posting)])

    def _fake_verdict(*, system, prompt, model, max_tokens):
        if "USER_A_THESIS_MARKER" in prompt:
            assert "USER_B_THESIS_MARKER" not in prompt
            return ('{"score": 0.9, "reason": "fits user A"}',
                    CompletionUsage(input_tokens=10, output_tokens=5))
        if "USER_B_THESIS_MARKER" in prompt:
            assert "USER_A_THESIS_MARKER" not in prompt
            return ('{"score": 0.3, "reason": "fits user B"}',
                    CompletionUsage(input_tokens=10, output_tokens=5))
        raise AssertionError(f"prompt contained neither user's thesis marker: {prompt!r}")

    monkeypatch.setattr(llm, "complete_with_usage", _fake_verdict)

    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((uid, pid, kw)))

    counters = fanout.run_fanout_cycle(["user-a", "user-b"])

    assert counters["stage4_calls"] == 2
    llm_writes = {uid: kw for uid, pid, kw in upserts if kw.get("reason_source") == "llm"}
    assert llm_writes["user-a"]["llm_score"] == pytest.approx(0.9)
    assert llm_writes["user-a"]["reason"] == "fits user A"
    assert llm_writes["user-b"]["llm_score"] == pytest.approx(0.3)
    assert llm_writes["user-b"]["reason"] == "fits user B"


def test_rubric_compile_never_leaks_profile_across_users(tmp_path, monkeypatch):
    """Same isolation property, but for stage 2's rubric compiler — the
    sibling LLM call site in the ladder. Neither user has a compiled
    rubric yet, so both trigger `compile_rubric_with_usage`."""
    dir_a = _profile_dir(
        tmp_path, "user-a",
        thesis="USER_A_THESIS_MARKER wants platform engineering.",
        disqualifiers_yaml="hard_disqualifiers: []\n",
    )
    dir_b = _profile_dir(
        tmp_path, "user-b",
        thesis="USER_B_THESIS_MARKER wants data science roles.",
        disqualifiers_yaml="hard_disqualifiers: []\n",
    )
    monkeypatch.setattr(
        fanout, "materialize_profile_dir",
        lambda uid: {"user-a": dir_a, "user-b": dir_b}[uid],
    )
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: None)
    compiled: dict[str, dict] = {}
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, rubric: compiled.__setitem__(uid, rubric))
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    ledger_events: list[tuple] = []
    monkeypatch.setattr(
        db, "insert_budget_ledger_row",
        lambda uid, event, **kw: ledger_events.append((uid, event)),
    )

    valid_rubric = _rubric()

    def _fake_complete(*, system, prompt, model, max_tokens):
        if model.startswith("claude-sonnet"):
            if "USER_A_THESIS_MARKER" in prompt:
                assert "USER_B_THESIS_MARKER" not in prompt
            elif "USER_B_THESIS_MARKER" in prompt:
                assert "USER_A_THESIS_MARKER" not in prompt
            else:
                raise AssertionError(f"rubric-compile prompt missing a thesis marker: {prompt!r}")
            return (json.dumps(valid_rubric), CompletionUsage(input_tokens=50, output_tokens=30))
        # stage 4
        return ('{"score": 0.5, "reason": "ok"}', CompletionUsage(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(llm, "complete_with_usage", _fake_complete)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)

    fanout.run_fanout_cycle(["user-a", "user-b"])

    assert set(compiled.keys()) == {"user-a", "user-b"}
    assert ("user-a", "rubric_compile") in ledger_events
    assert ("user-b", "rubric_compile") in ledger_events


# ── Cycle-level resilience ────────────────────────────────────────────────


def test_one_users_failure_does_not_abort_the_cycle(tmp_path, monkeypatch):
    dir_b = _profile_dir(tmp_path, "user-b")

    def _fake_materialize(uid):
        if uid == "user-a":
            raise RuntimeError("boom: broken profile row")
        return dir_b

    monkeypatch.setattr(fanout, "materialize_profile_dir", _fake_materialize)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    _fixed_verdict_llm(monkeypatch)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)

    counters = fanout.run_fanout_cycle(["user-a", "user-b"])

    assert counters["users_errored"] == 1
    assert counters["users_processed"] == 1  # user-b still completed


def test_run_fanout_cycle_defaults_to_every_profile_user(monkeypatch):
    monkeypatch.setattr(db, "list_profile_user_ids", lambda: [])

    counters = fanout.run_fanout_cycle()

    assert counters == {
        "users_processed": 0,
        "users_skipped_invalid": 0,
        "users_errored": 0,
        "users_global_capped": 0,
        "postings_scored": 0,
        "matches_written": 0,
        "stage4_calls": 0,
        "users_budget_stopped": 0,
        # ADM-2 Task 2: additive stage-funnel/cost counters, zero on an
        # empty-roster cycle same as everything else here.
        "postings_considered": 0,
        "passed_title_filter": 0,
        "embedded": 0,
        "cost_usd": 0.0,
    }


# ── H6 cost rails: hard per-user cap, global pool cap, BYO keys ──────────


def _setup_single_user_ladder(
    tmp_path, monkeypatch, *, n_postings: int, cap: float,
    global_spend: float = 0.0,
):
    """Shared scaffolding for the mid-batch-recheck tests: one user, an
    already-compiled rubric (so stage 2 never spends), N postings that
    all survive stage 1/2 unscored (real rubric scoring isn't the point
    here), no embeddings."""
    profile_dir = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: profile_dir)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: cap)
    monkeypatch.setattr(db, "get_global_month_to_date_spend", lambda: global_spend)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)
    postings = [_posting(f"p-{i}") for i in range(n_postings)]
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: postings)
    return profile_dir


def test_mid_batch_stop_at_exactly_the_kth_recheck(tmp_path, monkeypatch):
    """HOSTED_BUDGET_RECHECK_EVERY defaults to 5: with 20 eligible
    postings (more than the top-N=15 default would need), the loop must
    stop at EXACTLY the 5th verdict once spend crosses the cap at that
    recheck — never 4 (too early) or 6+ (recheck skipped)."""
    _setup_single_user_ladder(tmp_path, monkeypatch, n_postings=20, cap=1.0)

    spend_calls = {"n": 0}

    def _fake_spend(uid):
        spend_calls["n"] += 1
        # Call #1 is the pre-loop cap check (must be under cap so the loop
        # starts); every call after that is a mid-batch recheck, which
        # should only happen once, after verdict #5.
        return 0.0 if spend_calls["n"] == 1 else 5.0

    monkeypatch.setattr(db, "get_month_to_date_spend", _fake_spend)
    _fixed_verdict_llm(monkeypatch)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["stage4_calls"] == 5
    assert counters["users_budget_stopped"] == 1
    assert spend_calls["n"] == 2  # pre-loop check + exactly one mid-batch recheck


def test_mid_batch_recheck_does_not_fire_before_k(tmp_path, monkeypatch):
    """Under 5 postings, the loop finishes before ever reaching a K-th
    verdict — no mid-batch recheck fires, and nothing gets stopped."""
    _setup_single_user_ladder(tmp_path, monkeypatch, n_postings=3, cap=1.0)
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    _fixed_verdict_llm(monkeypatch)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["stage4_calls"] == 3
    assert counters["users_budget_stopped"] == 0


def test_global_cap_blocks_stage4_but_cached_rubric_still_scores(tmp_path, monkeypatch):
    """Global pool cap already exceeded at cycle start: a user with an
    EXISTING compiled rubric still gets stages 1-3 (rubric score + match
    write) — only stage 4 (new LLM spend) is blocked."""
    _setup_single_user_ladder(
        tmp_path, monkeypatch, n_postings=1, cap=100.0, global_spend=1_000.0,
    )
    upserts: list[tuple] = []
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: upserts.append((uid, pid, kw)))

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["users_errored"] == 0
    assert counters["matches_written"] == 1
    assert counters["stage4_calls"] == 0
    assert counters["users_global_capped"] >= 1
    assert upserts[0][2]["reason_source"] == "rubric"


def test_global_cap_skips_new_rubric_compile_for_uncompiled_user(tmp_path, monkeypatch):
    """Global pool cap exceeded AND the user has no cached rubric yet:
    the one-time compile call (real LLM spend) must not happen — proven
    by `_no_llm_by_default`'s autouse fixture, which raises if
    `llm.complete_with_usage` is ever called without an explicit fake."""
    profile_dir = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: profile_dir)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: None)
    monkeypatch.setattr(db, "get_global_month_to_date_spend", lambda: 1_000.0)
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    compiled: list[str] = []
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, rubric: compiled.append(uid))

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["users_errored"] == 0  # would be 1 if the boom fired
    assert compiled == []
    assert counters["matches_written"] == 0
    assert counters["users_global_capped"] >= 1


def test_byo_user_bypasses_both_caps_and_ledger_rows_flagged_byo(tmp_path, monkeypatch):
    """A user with an `api_keys` row compiles AND scores stage 4 on their
    own key even though BOTH the per-user cap and the global pool cap are
    already blown — and every ledger row for their calls is tagged
    `byo=True`."""
    profile_dir = _profile_dir(tmp_path, "user-a")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: profile_dir)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: None)
    monkeypatch.setattr(db, "get_global_month_to_date_spend", lambda: 1_000.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 999.0)
    monkeypatch.setattr(db, "get_api_key_ciphertext", lambda uid: "v1:nonce-a:ct-a")
    monkeypatch.setattr(fanout, "decrypt_key", lambda ct: "sk-ant-USER-A-KEY")
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, rubric: None)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)

    ledger_rows: list[tuple] = []
    monkeypatch.setattr(
        db, "insert_budget_ledger_row",
        lambda uid, event, **kw: ledger_rows.append((uid, event, kw)),
    )

    seen_api_keys: list[object] = []

    def _fake_complete(*, system, prompt, model, max_tokens, api_key=None):
        seen_api_keys.append(api_key)
        if model.startswith("claude-sonnet"):
            return (json.dumps(_rubric()), CompletionUsage(input_tokens=10, output_tokens=5))
        return (
            json.dumps({"score": 0.8, "reason": "byo verdict"}),
            CompletionUsage(input_tokens=10, output_tokens=5),
        )

    monkeypatch.setattr(llm, "complete_with_usage", _fake_complete)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["users_errored"] == 0
    assert counters["stage4_calls"] == 1
    assert counters["users_budget_stopped"] == 0
    assert counters["users_global_capped"] == 0
    assert seen_api_keys == ["sk-ant-USER-A-KEY", "sk-ant-USER-A-KEY"]  # compile + verdict
    assert ledger_rows  # rubric_compile + llm_verdict rows, both present
    assert all(kw["byo"] is True for _uid, _event, kw in ledger_rows)


def test_two_users_byo_and_pool_use_different_keys_no_cross_leak(tmp_path, monkeypatch):
    """Two users, one cycle: user-a has a BYO key, user-b doesn't. The
    isolation regression this task exists to catch — user-a's stage-4
    call must use HER decrypted key, user-b's must use the pool
    (`api_key=None`), never swapped. `run_fanout_cycle` processes
    `user_ids` in order with no reordering, so `calls[0]` is
    deterministically user-a's call and `calls[1]` is user-b's — mirrors
    `test_stage4_never_leaks_profile_across_users`'s approach but for key
    material instead of thesis text."""
    dir_a = _profile_dir(tmp_path, "user-a")
    dir_b = _profile_dir(tmp_path, "user-b")
    monkeypatch.setattr(
        fanout, "materialize_profile_dir",
        lambda uid: {"user-a": dir_a, "user-b": dir_b}[uid],
    )
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric())
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("shared-1")])

    monkeypatch.setattr(
        db, "get_api_key_ciphertext",
        lambda uid: "v1:nonce-a:ct-a" if uid == "user-a" else None,
    )
    monkeypatch.setattr(fanout, "decrypt_key", lambda ct: "sk-ant-USER-A-KEY")

    calls: list[object] = []

    def _fake_verdict(*, system, prompt, model, max_tokens, api_key=None):
        calls.append(api_key)
        return ('{"score": 0.5, "reason": "ok"}', CompletionUsage(input_tokens=5, output_tokens=5))

    monkeypatch.setattr(llm, "complete_with_usage", _fake_verdict)

    fanout.run_fanout_cycle(["user-a", "user-b"])

    assert calls == ["sk-ant-USER-A-KEY", None]


def test_byo_key_decrypt_failure_falls_back_to_pool_with_caps(tmp_path, monkeypatch):
    """A ciphertext that fails to decrypt (wrong/rotated secret, corrupt
    row) must degrade to the pool path for that user — never crash the
    cycle, never raise past `_run_user_ladder`."""
    _setup_single_user_ladder(tmp_path, monkeypatch, n_postings=1, cap=100.0)
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_api_key_ciphertext", lambda uid: "not-decryptable")
    # Real decrypt_key raises KeyDecryptionError on this malformed blob —
    # no need to monkeypatch it, exercising the real code path.
    calls = _fixed_verdict_llm(monkeypatch)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["users_errored"] == 0
    assert counters["stage4_calls"] == 1
    assert calls[0]["model"] == fanout.STAGE4_MODEL  # ran normally, on the pool


# ── ADM-2 Task 2: stage-funnel counters + cost accumulator ───────────────


def test_stage_funnel_counters_populated_for_a_one_user_cycle(tmp_path, monkeypatch):
    """`postings_considered` / `passed_title_filter` / `embedded` are each
    populated once per user: all of stage 1's input, stage 1's survivors,
    and stage 3's scored postings, respectively."""
    d = _profile_dir(
        tmp_path, "user-a", thesis="PROFILE_MARKER thesis text",
        portals_yaml="title_filter:\n  reject_substrings: ['intern']\n",
    )
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: _rubric(term="engineer"))
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)

    postings = [
        _posting("p-intern", title="Engineering Intern", description="engineer ALIGNED_MARKER"),
        _posting("aligned", description="engineer ALIGNED_MARKER"),
        _posting("orthogonal", description="engineer ORTHOGONAL_MARKER"),
    ]
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: postings)

    monkeypatch.setattr(embed, "embeddings_enabled", lambda: True)
    fake_client = _FakeVoyageClient({
        "PROFILE_MARKER": [1.0, 0.0],
        "ALIGNED_MARKER": [1.0, 0.0],
        "ORTHOGONAL_MARKER": [0.0, 1.0],
    })
    monkeypatch.setattr(embed, "_get_client", lambda: fake_client)
    monkeypatch.setattr(embed, "_client", None)

    profile_store: dict[str, list[float]] = {}
    posting_store: dict[str, list[float]] = {}
    monkeypatch.setattr(db, "get_profile_embedding", lambda uid: profile_store.get(uid))
    monkeypatch.setattr(db, "set_profile_embedding", lambda uid, vec: profile_store.__setitem__(uid, vec))
    monkeypatch.setattr(db, "get_posting_embedding", lambda pid: posting_store.get(pid))
    monkeypatch.setattr(db, "set_posting_embedding", lambda pid, vec: posting_store.__setitem__(pid, vec))

    _fixed_verdict_llm(monkeypatch)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert counters["postings_considered"] == 3  # every posting db.get_unmatched_postings returned
    assert counters["passed_title_filter"] == 2  # "p-intern" rejected by the title filter
    assert counters["embedded"] == 2  # both stage-2 survivors got a stage-3 embed score


def test_cost_usd_accumulates_rubric_compile_and_stage4_verdict(tmp_path, monkeypatch):
    """`counters['cost_usd']` sums every ledger cost written this
    cycle — one rubric compile (no cached rubric yet) plus one stage-4
    verdict — not just the last write."""
    d = _profile_dir(tmp_path, "user-a", disqualifiers_yaml="hard_disqualifiers: []\n")
    monkeypatch.setattr(fanout, "materialize_profile_dir", lambda uid: d)
    monkeypatch.setattr(db, "get_profile_validation_status", lambda uid: "valid")
    monkeypatch.setattr(db, "get_compiled_rubric", lambda uid: None)
    monkeypatch.setattr(db, "set_compiled_rubric", lambda uid, rubric: None)
    monkeypatch.setattr(db, "get_unmatched_postings", lambda uid: [_posting("p-1")])
    monkeypatch.setattr(db, "get_month_to_date_spend", lambda uid: 0.0)
    monkeypatch.setattr(db, "get_budget_cap", lambda uid: 100.0)

    ledger_costs: list[float] = []
    monkeypatch.setattr(
        db, "insert_budget_ledger_row",
        lambda uid, event, **kw: ledger_costs.append(kw["cost_usd"]),
    )

    valid_rubric = _rubric()

    def _fake_complete(*, system, prompt, model, max_tokens):
        if model.startswith("claude-sonnet"):
            return (json.dumps(valid_rubric), CompletionUsage(input_tokens=50, output_tokens=30))
        return ('{"score": 0.5, "reason": "ok"}', CompletionUsage(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(llm, "complete_with_usage", _fake_complete)
    monkeypatch.setattr(db, "upsert_match", lambda uid, pid, **kw: None)

    counters = fanout.run_fanout_cycle(["user-a"])

    assert len(ledger_costs) == 2  # rubric_compile + llm_verdict
    assert all(c > 0 for c in ledger_costs)
    assert counters["cost_usd"] == pytest.approx(sum(ledger_costs))
