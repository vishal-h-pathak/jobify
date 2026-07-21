"""tests/test_hunt_query_gen.py — jobify.hunt.sources.query_gen (HUNT2 P2
§4.3, session 53/S5): per-user, LLM-generated paid-search queries.

No live DB, no live LLM: `query_gen.db` (`jobify.db`) and `query_gen.llm`
(`jobify.shared.llm`) are monkeypatched directly at the module-attribute
level (rather than a fake Supabase client) since `ensure_user_queries`
only ever calls through those two seams, plus the local filesystem
(`tmp_path` standing in for a materialized profile cache dir).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from jobify.hunt.sources import query_gen
from jobify.shared.llm import CompletionUsage

_RUBRIC = {
    "rubric_version": 1,
    "term_groups": [{"group": "platform", "weight": 3.0, "terms": ["kubernetes"]}],
    "disqualifiers": [],
    "gates": {
        "location": {"remote_acceptable": True, "base_location_substring": "denver"},
    },
    "tier_hints": [{"pattern": "platform engineer", "tier": 1}],
}


def _stored_payload(queries, *, days_old=0, fingerprint="fp"):
    generated_at = datetime.now(timezone.utc) - timedelta(days=days_old)
    return json.dumps({
        "queries": queries,
        "generated_at": generated_at.isoformat(),
        "rubric_fingerprint": fingerprint,
    })


def _usage(input_tokens=100, output_tokens=20):
    return CompletionUsage(input_tokens=input_tokens, output_tokens=output_tokens)


class _NoDBAllowed:
    """Attribute access raises — proves the fast path never touches
    `jobify.db` at all (Rider A's zero-DB common path)."""

    def __getattr__(self, name):
        raise AssertionError(f"unexpected jobify.db access: {name!r}")


class _FakeDB:
    def __init__(self, *, recent_event=False):
        self.recent_event = recent_event
        self.ledger_rows: list[tuple] = []
        self.doc_writes: list[tuple] = []
        self.guard_calls: list[tuple] = []

    def has_recent_ledger_event(self, user_id, event, *, hours):
        self.guard_calls.append((user_id, event, hours))
        return self.recent_event

    def insert_budget_ledger_row(self, user_id, event, **kwargs):
        self.ledger_rows.append((user_id, event, kwargs))

    def update_profile_doc_file(self, user_id, filename, content):
        self.doc_writes.append((user_id, filename, content))


# ── fast path: fresh stored file costs zero DB access ────────────────────


def test_fresh_stored_queries_return_without_any_db_access(tmp_path, monkeypatch):
    (tmp_path / query_gen.STORAGE_FILENAME).write_text(
        _stored_payload(["Platform Engineer remote"], days_old=1), encoding="utf-8",
    )
    monkeypatch.setattr(query_gen, "db", _NoDBAllowed())

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=None)

    assert result == ["Platform Engineer remote"]


def test_stored_queries_just_under_freshness_boundary_are_fresh(tmp_path, monkeypatch):
    (tmp_path / query_gen.STORAGE_FILENAME).write_text(
        _stored_payload(["X"], days_old=query_gen.FRESHNESS_DAYS - 1), encoding="utf-8",
    )
    monkeypatch.setattr(query_gen, "db", _NoDBAllowed())

    assert query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=None) == ["X"]


def test_no_compiled_rubric_returns_none_without_ledger_check(tmp_path, monkeypatch):
    """Missing/empty file AND no compiled rubric yet: too early to
    generate, and no point even checking the runaway guard."""
    monkeypatch.setattr(query_gen, "db", _NoDBAllowed())

    assert query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=None) is None
    assert query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric={}) is None
    assert not (tmp_path / query_gen.STORAGE_FILENAME).is_file()


def test_malformed_stored_file_is_treated_as_missing(tmp_path, monkeypatch):
    (tmp_path / query_gen.STORAGE_FILENAME).write_text("not json", encoding="utf-8")
    monkeypatch.setattr(query_gen, "db", _NoDBAllowed())

    assert query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=None) is None


# ── slow path: stale/missing file, generation attempted ──────────────────


def test_stale_stored_queries_fall_through_to_slow_path(tmp_path, monkeypatch):
    (tmp_path / query_gen.STORAGE_FILENAME).write_text(
        _stored_payload(["Old Query"], days_old=query_gen.FRESHNESS_DAYS + 1),
        encoding="utf-8",
    )
    fake_db = _FakeDB(recent_event=False)
    monkeypatch.setattr(query_gen, "db", fake_db)
    monkeypatch.setattr(
        query_gen.llm, "complete_with_usage",
        lambda **kw: (json.dumps({"queries": ["Fresh Query"]}), _usage()),
    )

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=_RUBRIC)

    assert result == ["Fresh Query"]
    assert fake_db.guard_calls == [
        ("user-1", query_gen.QUERY_GEN_EVENT, query_gen.RUNAWAY_GUARD_HOURS)
    ]


def test_24h_guard_skips_generation_and_returns_none(tmp_path, monkeypatch):
    fake_db = _FakeDB(recent_event=True)
    monkeypatch.setattr(query_gen, "db", fake_db)
    called = []
    monkeypatch.setattr(
        query_gen.llm, "complete_with_usage",
        lambda **kw: called.append(kw) or (json.dumps({"queries": ["X"]}), _usage()),
    )

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=_RUBRIC)

    assert result is None
    assert called == []  # LLM never invoked
    assert not (tmp_path / query_gen.STORAGE_FILENAME).is_file()
    assert fake_db.ledger_rows == []


def test_successful_generation_writes_ledger_row_and_storage(tmp_path, monkeypatch):
    fake_db = _FakeDB(recent_event=False)
    monkeypatch.setattr(query_gen, "db", fake_db)
    response_text = json.dumps(
        {"queries": ["Platform Engineer remote", "SRE Denver", "  ", ""]}
    )
    monkeypatch.setattr(
        query_gen.llm, "complete_with_usage",
        lambda **kw: (response_text, _usage(100, 20)),
    )

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=_RUBRIC)

    assert result == ["Platform Engineer remote", "SRE Denver"]  # blanks stripped

    assert len(fake_db.ledger_rows) == 1
    user_id, event, kwargs = fake_db.ledger_rows[0]
    assert user_id == "user-1"
    assert event == query_gen.QUERY_GEN_EVENT
    assert kwargs["model"] == query_gen.GENERATOR_MODEL
    assert kwargs["input_tokens"] == 100
    assert kwargs["output_tokens"] == 20
    assert kwargs["cost_usd"] == pytest.approx(query_gen._cost_usd(100, 20))
    assert kwargs["cost_usd"] > 0

    stored = json.loads(
        (tmp_path / query_gen.STORAGE_FILENAME).read_text(encoding="utf-8")
    )
    assert stored["queries"] == ["Platform Engineer remote", "SRE Denver"]
    assert stored["rubric_fingerprint"] == query_gen._fingerprint(_RUBRIC)
    datetime.fromisoformat(stored["generated_at"])  # parseable, present

    assert len(fake_db.doc_writes) == 1
    doc_user_id, filename, content = fake_db.doc_writes[0]
    assert doc_user_id == "user-1"
    assert filename == query_gen.STORAGE_FILENAME
    assert json.loads(content) == stored


def test_generation_caps_at_max_queries(tmp_path, monkeypatch):
    fake_db = _FakeDB()
    monkeypatch.setattr(query_gen, "db", fake_db)
    many = [f"Query {i}" for i in range(15)]
    monkeypatch.setattr(
        query_gen.llm, "complete_with_usage",
        lambda **kw: (json.dumps({"queries": many}), _usage()),
    )

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=_RUBRIC)

    assert result == many[: query_gen.MAX_QUERIES]
    assert len(result) == query_gen.MAX_QUERIES


# ── failure handling: retry once, never cache a failure ─────────────────


def test_invalid_json_retries_once_then_fails_without_caching(tmp_path, monkeypatch):
    fake_db = _FakeDB()
    monkeypatch.setattr(query_gen, "db", fake_db)
    calls = {"n": 0}

    def _fake_complete(**_kw):
        calls["n"] += 1
        return "not json at all", _usage()

    monkeypatch.setattr(query_gen.llm, "complete_with_usage", _fake_complete)

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=_RUBRIC)

    assert result is None
    assert calls["n"] == 2  # a fresh retry, not a repair prompt
    assert not (tmp_path / query_gen.STORAGE_FILENAME).is_file()
    assert fake_db.ledger_rows == []  # never billed for a failure
    assert fake_db.doc_writes == []


def test_empty_queries_list_counts_as_invalid_and_retries(tmp_path, monkeypatch):
    fake_db = _FakeDB()
    monkeypatch.setattr(query_gen, "db", fake_db)
    monkeypatch.setattr(
        query_gen.llm, "complete_with_usage",
        lambda **kw: (json.dumps({"queries": []}), _usage()),
    )

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=_RUBRIC)

    assert result is None
    assert not (tmp_path / query_gen.STORAGE_FILENAME).is_file()


def test_llm_call_exception_retries_once_then_fails_gracefully(tmp_path, monkeypatch):
    fake_db = _FakeDB()
    monkeypatch.setattr(query_gen, "db", fake_db)
    calls = {"n": 0}

    def _boom(**_kw):
        calls["n"] += 1
        raise RuntimeError("no usable Anthropic auth")

    monkeypatch.setattr(query_gen.llm, "complete_with_usage", _boom)

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=_RUBRIC)

    assert result is None
    assert calls["n"] == 2
    assert not (tmp_path / query_gen.STORAGE_FILENAME).is_file()
    assert fake_db.ledger_rows == []


def test_second_attempt_succeeds_after_first_invalid_response(tmp_path, monkeypatch):
    fake_db = _FakeDB()
    monkeypatch.setattr(query_gen, "db", fake_db)
    responses = iter(["not json", json.dumps({"queries": ["Good Query"]})])
    monkeypatch.setattr(
        query_gen.llm, "complete_with_usage",
        lambda **kw: (next(responses), _usage()),
    )

    result = query_gen.ensure_user_queries("user-1", tmp_path, compiled_rubric=_RUBRIC)

    assert result == ["Good Query"]
    assert len(fake_db.ledger_rows) == 1


# ── fingerprint ───────────────────────────────────────────────────────────


def test_fingerprint_stable_regardless_of_key_order():
    a = {"a": 1, "b": [1, 2, 3]}
    b = {"b": [1, 2, 3], "a": 1}
    assert query_gen._fingerprint(a) == query_gen._fingerprint(b)


def test_fingerprint_differs_for_different_content():
    assert query_gen._fingerprint({"a": 1}) != query_gen._fingerprint({"a": 2})
