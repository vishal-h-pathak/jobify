"""tests/test_db_hosted.py — jobify.db's H4 additions.

`set_profile_validation_status`, `list_profile_user_ids`,
`insert_budget_ledger_row`, `get_month_to_date_spend`, `get_budget_cap`,
`upsert_posting`, and the posting/profile embedding get/set helpers: the
profile-validation write, budget-ledger read/write, and (Task 2) global
discovery + embedding storage helpers the hosted worker calls. Chainable
Supabase double, mirroring `tests/test_manual_upsert.py` /
`tests/test_rescore.py`'s pattern. Wired in via the shared
`patch_db_client` fixture (`tests/conftest.py`) — no live Supabase.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from jobify import db


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Mimics ``client.table(...).select|insert|update|eq|gte|in_|execute()``.

    ``eq()`` filters the backing rows (needed so the spend-sum test only
    sees one user's rows); ``gte()`` only records its call, matching
    ``tests/test_rescore.py``'s fake (this module's date filtering is a
    server-side concern the fake doesn't need to reimplement). ``in_()``
    filters like ``eq()`` but against a list of acceptable values (LIV-1's
    `get_matches_by_states`/`get_postings_by_ids`).
    """

    def __init__(self, rows: list[dict]):
        self._rows = list(rows)
        self._mode: str | None = None
        self.insert_payload: dict | None = None
        self.update_payload: dict | None = None
        self.upsert_payload: dict | None = None
        self.upsert_on_conflict: str | None = None
        self.eq_calls: list[tuple[str, object]] = []
        self.gte_calls: list[tuple[str, object]] = []
        self.gt_calls: list[tuple[str, object]] = []

    def select(self, *_a, **_k):
        self._mode = "select"
        return self

    def insert(self, payload):
        self._mode = "insert"
        self.insert_payload = payload
        return self

    def update(self, payload):
        self._mode = "update"
        self.update_payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        self._mode = "upsert"
        self.upsert_payload = payload
        self.upsert_on_conflict = on_conflict
        return self

    def eq(self, col, val):
        self.eq_calls.append((col, val))
        self._rows = [r for r in self._rows if r.get(col) == val]
        return self

    def gte(self, col, val):
        self.gte_calls.append((col, val))
        return self

    def gt(self, col, val):
        self.gt_calls.append((col, val))
        return self

    def in_(self, col, vals):
        self._rows = [r for r in self._rows if r.get(col) in vals]
        return self

    def execute(self):
        if self._mode in ("insert", "update", "upsert"):
            return _FakeResult([])
        return _FakeResult(list(self._rows))


class _FakeClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self._tables = tables or {}
        self.queries: list[tuple[str, _FakeQuery]] = []

    def table(self, name):
        q = _FakeQuery(self._tables.get(name, []))
        self.queries.append((name, q))
        return q


# ── set_profile_validation_status ───────────────────────────────────────


def test_set_profile_validation_status_writes_expected_payload(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.set_profile_validation_status("user-1", "invalid", errors=["profile.yml: empty"])

    name, q = fake.queries[-1]
    assert name == "profiles"
    assert q.update_payload == {
        "validation_status": {"status": "invalid", "errors": ["profile.yml: empty"]}
    }
    assert q.eq_calls == [("user_id", "user-1")]


# ── insert_budget_ledger_row ─────────────────────────────────────────────


def test_insert_budget_ledger_row_writes_all_columns(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.insert_budget_ledger_row(
        "user-1", "llm_verdict",
        model="claude-haiku-4-5", input_tokens=100, output_tokens=20,
        cost_usd=0.0042, run_id="run-abc",
    )

    name, q = fake.queries[-1]
    assert name == "budget_ledger"
    assert q.insert_payload == {
        "user_id": "user-1",
        "event": "llm_verdict",
        "model": "claude-haiku-4-5",
        "input_tokens": 100,
        "output_tokens": 20,
        "cost_usd": 0.0042,
        "run_id": "run-abc",
        "byo": False,
    }


def test_insert_budget_ledger_row_byo_true_is_written(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.insert_budget_ledger_row(
        "user-1", "llm_verdict",
        model="claude-haiku-4-5", input_tokens=100, output_tokens=20,
        cost_usd=0.0042, byo=True,
    )

    _, q = fake.queries[-1]
    assert q.insert_payload["byo"] is True


def test_insert_budget_ledger_row_defaults_are_zero_and_none(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.insert_budget_ledger_row("user-1", "rubric_compile")

    _, q = fake.queries[-1]
    assert q.insert_payload == {
        "user_id": "user-1",
        "event": "rubric_compile",
        "model": None,
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_usd": 0.0,
        "run_id": None,
        "byo": False,
    }


# ── get_month_to_date_spend ──────────────────────────────────────────────


def test_get_month_to_date_spend_sums_only_this_users_rows(patch_db_client):
    fake = _FakeClient({
        "budget_ledger": [
            {"user_id": "user-1", "cost_usd": 1.5, "byo": False},
            {"user_id": "user-1", "cost_usd": 2.25, "byo": False},
            {"user_id": "user-2", "cost_usd": 99.0, "byo": False},
        ]
    })
    patch_db_client(fake)

    assert db.get_month_to_date_spend("user-1") == pytest.approx(3.75)


def test_get_month_to_date_spend_excludes_byo_rows(patch_db_client):
    """A BYO row (the user's own decrypted key) must never count against
    their pool cap — 0006_cost_rails.sql's whole reason for the column."""
    fake = _FakeClient({
        "budget_ledger": [
            {"user_id": "user-1", "cost_usd": 1.5, "byo": False},
            {"user_id": "user-1", "cost_usd": 500.0, "byo": True},
        ]
    })
    patch_db_client(fake)

    assert db.get_month_to_date_spend("user-1") == pytest.approx(1.5)


def test_get_month_to_date_spend_zero_for_no_rows(patch_db_client):
    fake = _FakeClient({"budget_ledger": []})
    patch_db_client(fake)

    assert db.get_month_to_date_spend("user-1") == 0.0


def test_get_month_to_date_spend_filters_by_utc_month_start(patch_db_client):
    fake = _FakeClient({"budget_ledger": []})
    patch_db_client(fake)

    db.get_month_to_date_spend("user-1")

    _, q = fake.queries[-1]
    assert q.gte_calls, "expected a created_at >= month-start filter"
    col, val = q.gte_calls[0]
    assert col == "created_at"
    now = datetime.now(timezone.utc)
    assert val.startswith(now.strftime("%Y-%m-01T00:00:00"))


# ── get_global_month_to_date_spend (H6) ──────────────────────────────────


def test_get_global_month_to_date_spend_sums_every_user_and_null(patch_db_client):
    fake = _FakeClient({
        "budget_ledger": [
            {"user_id": "user-1", "cost_usd": 1.5, "byo": False},
            {"user_id": "user-2", "cost_usd": 2.5, "byo": False},
            {"user_id": None, "cost_usd": 0.25, "byo": False},
        ]
    })
    patch_db_client(fake)

    assert db.get_global_month_to_date_spend() == pytest.approx(4.25)


def test_get_global_month_to_date_spend_excludes_byo_rows(patch_db_client):
    fake = _FakeClient({
        "budget_ledger": [
            {"user_id": "user-1", "cost_usd": 1.0, "byo": False},
            {"user_id": "user-2", "cost_usd": 500.0, "byo": True},
        ]
    })
    patch_db_client(fake)

    assert db.get_global_month_to_date_spend() == pytest.approx(1.0)


# ── get_api_key_ciphertext (H6 BYO keys) ─────────────────────────────────


def test_get_api_key_ciphertext_returns_row_value(patch_db_client):
    fake = _FakeClient({
        "api_keys": [{"user_id": "user-1", "encrypted_key": "v1:nonce:ct"}],
    })
    patch_db_client(fake)

    assert db.get_api_key_ciphertext("user-1") == "v1:nonce:ct"


def test_get_api_key_ciphertext_none_when_no_row(patch_db_client):
    fake = _FakeClient({"api_keys": []})
    patch_db_client(fake)

    assert db.get_api_key_ciphertext("user-1") is None


# ── get_budget_cap ─────────────────────────────────────────────────────


def test_get_budget_cap_returns_row_value(patch_db_client):
    fake = _FakeClient({"budget_caps": [{"user_id": "user-1", "monthly_usd_cap": 12.5}]})
    patch_db_client(fake)

    assert db.get_budget_cap("user-1") == 12.5


def test_get_budget_cap_falls_back_to_default_when_row_missing(patch_db_client):
    fake = _FakeClient({"budget_caps": []})
    patch_db_client(fake)

    assert db.get_budget_cap("user-1") == db.DEFAULT_MONTHLY_USD_CAP
    assert db.DEFAULT_MONTHLY_USD_CAP == 5.00


# ── list_profile_user_ids (H4 Task 2) ────────────────────────────────────


def test_list_profile_user_ids_returns_every_row(patch_db_client):
    fake = _FakeClient({
        "profiles": [{"user_id": "user-1"}, {"user_id": "user-2"}],
    })
    patch_db_client(fake)

    assert db.list_profile_user_ids() == ["user-1", "user-2"]


def test_list_profile_user_ids_empty_table(patch_db_client):
    fake = _FakeClient({"profiles": []})
    patch_db_client(fake)

    assert db.list_profile_user_ids() == []


# ── insert_budget_ledger_row: nullable user_id (H4 Task 2) ──────────────


def test_insert_budget_ledger_row_accepts_null_user_id_for_global_cost(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.insert_budget_ledger_row(
        None, "embedding", model="voyage-3.5-lite", input_tokens=50, cost_usd=0.000001,
    )

    _, q = fake.queries[-1]
    assert q.insert_payload["user_id"] is None
    assert q.insert_payload["event"] == "embedding"


# ── upsert_posting (H4 Task 2 discovery) ─────────────────────────────────


def _posting_job(**overrides):
    job = {
        "id": "posting-1",
        "title": "Platform Engineer",
        "company": "Acme Co",
        "location": "Remote",
        "description": "desc",
        "application_url": "https://boards.greenhouse.io/acmeco/jobs/1",
        "ats_kind": "greenhouse",
        "link_status": "direct",
        "source": "greenhouse",
    }
    job.update(overrides)
    return job


def test_upsert_posting_writes_expected_payload_and_on_conflict(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.upsert_posting(_posting_job())

    name, q = fake.queries[-1]
    assert name == "postings"
    assert q.upsert_on_conflict == "id"
    payload = q.upsert_payload
    assert payload["id"] == "posting-1"
    assert payload["title"] == "Platform Engineer"
    assert payload["application_url"] == "https://boards.greenhouse.io/acmeco/jobs/1"
    assert payload["ats_kind"] == "greenhouse"
    assert payload["link_status"] == "direct"
    assert payload["source"] == "greenhouse"
    assert "last_seen_at" in payload
    # first_seen_at is deliberately absent so the column's own DB DEFAULT
    # only fires on the initial insert and a re-upsert never touches it.
    assert "first_seen_at" not in payload


@pytest.mark.parametrize("remote_value", [True, False, None])
def test_upsert_posting_persists_remote_tri_state(patch_db_client, remote_value):
    """Post-merge-review fix: `remote` used to be silently dropped at this
    write boundary despite every fetcher computing a real tri-state value
    (`sources.remote_infer.infer_remote`) — severing P0.2/P0.7 end-to-end
    (see this function's docstring in `jobify/db.py`). All three states
    (True/False/None-i.e.-unknown) must survive into the upsert payload
    unchanged, not just the truthy case."""
    fake = _FakeClient()
    patch_db_client(fake)

    db.upsert_posting(_posting_job(remote=remote_value))

    _, q = fake.queries[-1]
    assert q.upsert_payload["remote"] is remote_value


def test_upsert_posting_uses_service_role_client(patch_db_client):
    """Matches upsert_job's pattern exactly: writes go through
    `_get_client()`, the same client attribute the single-user pipeline's
    write helpers use (refuses a demonstrably-anon key)."""
    fake = _FakeClient()
    patch_db_client(fake)

    db.upsert_posting(_posting_job())

    assert fake.queries[-1][0] == "postings"


# ── posting/profile embedding get/set (H4 Task 2 embed.py) ──────────────


def test_get_posting_embedding_returns_none_when_missing(patch_db_client):
    fake = _FakeClient({"postings": []})
    patch_db_client(fake)

    assert db.get_posting_embedding("posting-1") is None


def test_get_posting_embedding_returns_stored_vector(patch_db_client):
    fake = _FakeClient({"postings": [{"id": "posting-1", "embedding": [0.1, 0.2]}]})
    patch_db_client(fake)

    assert db.get_posting_embedding("posting-1") == [0.1, 0.2]


def test_set_posting_embedding_writes_expected_payload(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.set_posting_embedding("posting-1", [0.1, 0.2])

    name, q = fake.queries[-1]
    assert name == "postings"
    assert q.update_payload == {"embedding": [0.1, 0.2]}
    assert q.eq_calls == [("id", "posting-1")]


def test_get_profile_embedding_returns_none_when_missing(patch_db_client):
    fake = _FakeClient({"profiles": []})
    patch_db_client(fake)

    assert db.get_profile_embedding("user-1") is None


def test_get_profile_embedding_returns_stored_vector(patch_db_client):
    fake = _FakeClient({"profiles": [{"user_id": "user-1", "embedding": [0.3, 0.4]}]})
    patch_db_client(fake)

    assert db.get_profile_embedding("user-1") == [0.3, 0.4]


def test_set_profile_embedding_writes_expected_payload(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.set_profile_embedding("user-1", [0.3, 0.4])

    name, q = fake.queries[-1]
    assert name == "profiles"
    assert q.update_payload == {"embedding": [0.3, 0.4]}
    assert q.eq_calls == [("user_id", "user-1")]


# ── get_profile_validation_status (H4 Task 3) ────────────────────────────


def test_get_profile_validation_status_returns_stored_value(patch_db_client):
    fake = _FakeClient({
        "profiles": [{
            "user_id": "user-1",
            "validation_status": {"status": "invalid", "errors": ["thesis.md: empty"]},
        }],
    })
    patch_db_client(fake)

    assert db.get_profile_validation_status("user-1") == "invalid"


def test_get_profile_validation_status_tolerates_legacy_bare_string(patch_db_client):
    """Pre-reconciliation rows (or H3's TS pre-check writing a bare value)
    must not crash the fan-out gate — a bare string passes through."""
    fake = _FakeClient({
        "profiles": [{"user_id": "user-1", "validation_status": "invalid"}],
    })
    patch_db_client(fake)

    assert db.get_profile_validation_status("user-1") == "invalid"


def test_get_profile_validation_status_none_when_row_missing(patch_db_client):
    fake = _FakeClient({"profiles": []})
    patch_db_client(fake)

    assert db.get_profile_validation_status("user-1") is None


def test_get_profile_validation_status_none_when_column_null(patch_db_client):
    fake = _FakeClient({"profiles": [{"user_id": "user-1", "validation_status": None}]})
    patch_db_client(fake)

    assert db.get_profile_validation_status("user-1") is None


# ── get_compiled_rubric / set_compiled_rubric (H4 Task 3) ────────────────


def test_get_compiled_rubric_returns_stored_rubric(patch_db_client):
    rubric = {"rubric_version": 1, "term_groups": []}
    fake = _FakeClient({"profiles": [{"user_id": "user-1", "compiled_rubric": rubric}]})
    patch_db_client(fake)

    assert db.get_compiled_rubric("user-1") == rubric


def test_get_compiled_rubric_none_when_row_missing(patch_db_client):
    fake = _FakeClient({"profiles": []})
    patch_db_client(fake)

    assert db.get_compiled_rubric("user-1") is None


def test_set_compiled_rubric_writes_expected_payload(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)
    rubric = {"rubric_version": 1, "term_groups": []}

    db.set_compiled_rubric("user-1", rubric)

    name, q = fake.queries[-1]
    assert name == "profiles"
    assert q.update_payload == {"compiled_rubric": rubric}
    assert q.eq_calls == [("user_id", "user-1")]


# ── upsert_match (H4 Task 3) ──────────────────────────────────────────────


def test_upsert_match_writes_expected_payload_and_on_conflict(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.upsert_match(
        "user-1", "posting-1",
        rubric_score=0.8, embed_score=None, reason="matched:core (+1)",
        reason_source="rubric",
    )

    name, q = fake.queries[-1]
    assert name == "matches"
    assert q.upsert_on_conflict == "user_id,posting_id"
    assert q.upsert_payload == {
        "user_id": "user-1",
        "posting_id": "posting-1",
        "rubric_score": 0.8,
        "embed_score": None,
        "reason": "matched:core (+1)",
        "reason_source": "rubric",
    }


def test_upsert_match_never_includes_state_columns(patch_db_client):
    """The core state-preservation contract: `upsert_match` never writes
    `state` / `state_changed_at` itself, regardless of what fields the
    caller passes — so a real Postgrest `ON CONFLICT DO UPDATE SET`
    (which only touches columns present in the payload) leaves an
    already-triaged row's `state` (`saved` / `dismissed` / `applied`)
    completely alone on a re-score. Only the column's own DB DEFAULT
    (`'new'`) can ever set `state`, and only on the first insert."""
    fake = _FakeClient()
    patch_db_client(fake)

    db.upsert_match("user-1", "posting-1", llm_score=0.9, reason="x", reason_source="llm")

    _, q = fake.queries[-1]
    assert "state" not in q.upsert_payload
    assert "state_changed_at" not in q.upsert_payload


# ── get_unmatched_postings (H4 Task 3) ────────────────────────────────────


def test_get_unmatched_postings_excludes_already_matched(patch_db_client):
    fake = _FakeClient({
        "matches": [{"user_id": "user-1", "posting_id": "p-1"}],
        "postings": [
            {"id": "p-1", "title": "Already matched"},
            {"id": "p-2", "title": "Not yet matched"},
        ],
    })
    patch_db_client(fake)

    result = db.get_unmatched_postings("user-1")

    assert [p["id"] for p in result] == ["p-2"]


def test_get_unmatched_postings_filters_matches_by_user(patch_db_client):
    """Another user's matches rows must not exclude postings for this user."""
    fake = _FakeClient({
        "matches": [{"user_id": "user-2", "posting_id": "p-1"}],
        "postings": [{"id": "p-1", "title": "Only matched for user-2"}],
    })
    patch_db_client(fake)

    result = db.get_unmatched_postings("user-1")

    assert [p["id"] for p in result] == ["p-1"]


def test_get_unmatched_postings_empty_when_no_postings(patch_db_client):
    fake = _FakeClient({"matches": [], "postings": []})
    patch_db_client(fake)

    assert db.get_unmatched_postings("user-1") == []


def test_get_unmatched_postings_excludes_expired_link_status(patch_db_client):
    """A posting `jobify.hosted.discovery` upserted with
    `link_status='expired'` (dead-link liveness check) must never reach a
    user's scoring candidate pool, even though it has no `matches` row.
    Any other `link_status` — including a missing/None value, which is
    what most postings carry — stays included.
    """
    fake = _FakeClient({
        "matches": [],
        "postings": [
            {"id": "p-1", "title": "Dead link", "link_status": "expired"},
            {"id": "p-2", "title": "Direct link", "link_status": "direct"},
            {"id": "p-3", "title": "Unverified aggregator", "link_status": "aggregator_unverified"},
            {"id": "p-4", "title": "No link_status set"},
        ],
    })
    patch_db_client(fake)

    result = db.get_unmatched_postings("user-1")

    assert [p["id"] for p in result] == ["p-2", "p-3", "p-4"]


# ── get_posting_reactions / get_matches_by_states / get_postings_by_ids /
#    update_profile_doc_file (LIV-1 learning pass) ────────────────────────


def test_get_posting_reactions_returns_only_this_users_rows(patch_db_client):
    fake = _FakeClient({
        "posting_reactions": [
            {"user_id": "user-1", "posting_id": "p-1", "reaction": "interested"},
            {"user_id": "user-2", "posting_id": "p-2", "reaction": "not_interested"},
            {"user_id": "user-1", "posting_id": "p-3", "reaction": "not_interested"},
        ],
    })
    patch_db_client(fake)

    result = db.get_posting_reactions("user-1")

    assert {r["posting_id"] for r in result} == {"p-1", "p-3"}


def test_get_matches_by_states_filters_to_requested_states(patch_db_client):
    fake = _FakeClient({
        "matches": [
            {"user_id": "user-1", "posting_id": "p-1", "state": "new"},
            {"user_id": "user-1", "posting_id": "p-2", "state": "seen"},
            {"user_id": "user-1", "posting_id": "p-3", "state": "saved"},
            {"user_id": "user-1", "posting_id": "p-4", "state": "dismissed"},
        ],
    })
    patch_db_client(fake)

    result = db.get_matches_by_states("user-1", ["saved", "dismissed"])

    assert {r["posting_id"] for r in result} == {"p-3", "p-4"}


def test_get_postings_by_ids_returns_matching_rows(patch_db_client):
    fake = _FakeClient({
        "postings": [
            {"id": "p-1", "title": "One"},
            {"id": "p-2", "title": "Two"},
            {"id": "p-3", "title": "Three"},
        ],
    })
    patch_db_client(fake)

    result = db.get_postings_by_ids(["p-1", "p-3"])

    assert {p["id"] for p in result} == {"p-1", "p-3"}


def test_get_postings_by_ids_empty_input_issues_no_query(patch_db_client):
    fake = _FakeClient({"postings": [{"id": "p-1", "title": "One"}]})
    patch_db_client(fake)

    assert db.get_postings_by_ids([]) == []
    assert fake.queries == []


def test_update_profile_doc_file_merges_new_key_into_existing_doc(patch_db_client):
    fake = _FakeClient({
        "profiles": [
            {"user_id": "user-1", "doc": {"thesis.md": "old thesis", "cv.md": "old cv"}},
        ],
    })
    patch_db_client(fake)

    db.update_profile_doc_file("user-1", "learned-insights.md", "new insight content")

    update_queries = [q for name, q in fake.queries if name == "profiles" and q.update_payload]
    assert len(update_queries) == 1
    payload = update_queries[0].update_payload
    assert payload == {
        "doc": {
            "thesis.md": "old thesis",
            "cv.md": "old cv",
            "learned-insights.md": "new insight content",
        }
    }
    assert update_queries[0].eq_calls == [("user_id", "user-1")]


def test_update_profile_doc_file_noop_when_profiles_row_missing(patch_db_client):
    fake = _FakeClient({"profiles": []})
    patch_db_client(fake)

    db.update_profile_doc_file("user-1", "learned-insights.md", "content")

    assert all(q.update_payload is None for _name, q in fake.queries)


def test_update_profile_doc_file_noop_when_doc_not_a_dict(patch_db_client):
    fake = _FakeClient({
        "profiles": [{"user_id": "user-1", "doc": None}],
    })
    patch_db_client(fake)

    db.update_profile_doc_file("user-1", "learned-insights.md", "content")

    assert all(q.update_payload is None for _name, q in fake.queries)


# ── insert_hunt_cycle_row (ADM-2 Task 2) ─────────────────────────────────


def test_insert_hunt_cycle_row_writes_all_columns(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.insert_hunt_cycle_row(
        started_at="2026-07-05T00:00:00+00:00",
        finished_at="2026-07-05T00:05:00+00:00",
        mode="full",
        triggered_by="manual",
        users_scored=2,
        postings_fetched=5,
        postings_upserted=4,
        counters={"users_processed": 2, "cost_usd": 0.0123},
        cost_usd=0.0123,
        error=None,
    )

    name, q = fake.queries[-1]
    assert name == "hunt_cycles"
    assert q.insert_payload == {
        "started_at": "2026-07-05T00:00:00+00:00",
        "finished_at": "2026-07-05T00:05:00+00:00",
        "mode": "full",
        "triggered_by": "manual",
        "users_scored": 2,
        "postings_fetched": 5,
        "postings_upserted": 4,
        "counters": {"users_processed": 2, "cost_usd": 0.0123},
        "cost_usd": 0.0123,
        "error": None,
    }


def test_insert_hunt_cycle_row_defaults(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.insert_hunt_cycle_row(started_at="2026-07-05T00:00:00+00:00", mode="discovery_only")

    _, q = fake.queries[-1]
    assert q.insert_payload == {
        "started_at": "2026-07-05T00:00:00+00:00",
        "finished_at": None,
        "mode": "discovery_only",
        "triggered_by": None,
        "users_scored": 0,
        "postings_fetched": 0,
        "postings_upserted": 0,
        "counters": None,
        "cost_usd": 0.0,
        "error": None,
    }


def test_insert_hunt_cycle_row_error_row(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.insert_hunt_cycle_row(
        started_at="2026-07-05T00:00:00+00:00",
        finished_at="2026-07-05T00:00:01+00:00",
        mode="full",
        triggered_by="cron",
        error="discovery phase blew up",
    )

    _, q = fake.queries[-1]
    assert q.insert_payload["error"] == "discovery phase blew up"


# ── tailor_runs (V3b Task 4) ──────────────────────────────────────────────


def test_get_tailor_run_returns_stored_row(patch_db_client):
    row = {"id": "run-1", "status": "queued", "progress": []}
    fake = _FakeClient({"tailor_runs": [row]})
    patch_db_client(fake)

    assert db.get_tailor_run("run-1") == row


def test_get_tailor_run_none_when_missing(patch_db_client):
    fake = _FakeClient({"tailor_runs": []})
    patch_db_client(fake)

    assert db.get_tailor_run("run-1") is None


def test_mark_tailor_run_running_writes_status_and_bumps_updated_at(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.mark_tailor_run_running("run-1")

    name, q = fake.queries[-1]
    assert name == "tailor_runs"
    assert q.update_payload["status"] == "running"
    assert "updated_at" in q.update_payload
    assert set(q.update_payload) == {"status", "updated_at"}
    assert q.eq_calls == [("id", "run-1")]


def test_mark_tailor_run_succeeded_writes_expected_columns(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.mark_tailor_run_succeeded(
        "run-1", dropped_count=2, cost_usd=0.0456, doc_sha256="deadbeef"
    )

    name, q = fake.queries[-1]
    assert name == "tailor_runs"
    assert q.update_payload["status"] == "succeeded"
    assert q.update_payload["dropped_count"] == 2
    assert q.update_payload["cost_usd"] == 0.0456
    assert q.update_payload["doc_sha256"] == "deadbeef"
    assert "updated_at" in q.update_payload
    assert set(q.update_payload) == {
        "status", "dropped_count", "cost_usd", "doc_sha256", "updated_at",
    }
    assert q.eq_calls == [("id", "run-1")]


def test_mark_tailor_run_failed_writes_error_and_status(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.mark_tailor_run_failed("run-1", "pdflatex exited 1")

    name, q = fake.queries[-1]
    assert name == "tailor_runs"
    assert q.update_payload["status"] == "failed"
    assert q.update_payload["error"] == "pdflatex exited 1"
    assert "updated_at" in q.update_payload
    assert set(q.update_payload) == {"status", "error", "updated_at"}
    assert q.eq_calls == [("id", "run-1")]


def test_append_tailor_run_progress_writes_one_entry_with_step_label_at(patch_db_client):
    fake = _FakeClient({"tailor_runs": [{"id": "run-1", "progress": []}]})
    patch_db_client(fake)

    db.append_tailor_run_progress("run-1", "resume", "Generating resume")

    # Second query is the update (first was the read-modify-write's select).
    update_queries = [q for name, q in fake.queries if name == "tailor_runs" and q._mode == "update"]
    assert len(update_queries) == 1
    written = update_queries[-1].update_payload["progress"]
    assert len(written) == 1
    assert written[0]["step"] == "resume"
    assert written[0]["label"] == "Generating resume"
    assert "at" in written[0]


def test_append_tailor_run_progress_starts_fresh_when_no_prior_progress(patch_db_client):
    # No pre-seeded row at all (worker's very first progress call on a
    # freshly-claimed run) — must not blow up on a missing row.
    fake = _FakeClient({"tailor_runs": []})
    patch_db_client(fake)

    db.append_tailor_run_progress("run-1", "claim", "Run claimed")

    update_queries = [q for name, q in fake.queries if name == "tailor_runs" and q._mode == "update"]
    written = update_queries[-1].update_payload["progress"]
    assert written == [
        {"step": "claim", "label": "Run claimed", "at": written[0]["at"]}
    ]


def test_append_tailor_run_progress_accumulates_across_two_calls(patch_db_client):
    # The fake's `.table()` rebuilds a fresh `_FakeQuery` from the ORIGINAL
    # backing dict on every call — it doesn't persist writes the way real
    # Postgres does. To exercise real accumulation (not just the shape of
    # one write), manually thread the first call's written array back into
    # the fake's backing row before the second call, simulating what the
    # real read-after-write round trip would see.
    tailor_runs_table = [{"id": "run-1", "progress": []}]
    fake = _FakeClient({"tailor_runs": tailor_runs_table})
    patch_db_client(fake)

    db.append_tailor_run_progress("run-1", "resume", "Generating resume")
    first_update = [
        q for name, q in fake.queries if name == "tailor_runs" and q._mode == "update"
    ][-1]
    progress_after_first = first_update.update_payload["progress"]
    assert len(progress_after_first) == 1

    tailor_runs_table[0]["progress"] = progress_after_first

    db.append_tailor_run_progress("run-1", "cover_letter", "Generating cover letter")
    second_update = [
        q for name, q in fake.queries if name == "tailor_runs" and q._mode == "update"
    ][-1]
    progress_after_second = second_update.update_payload["progress"]

    assert len(progress_after_second) == 2
    assert progress_after_second[0]["step"] == "resume"
    assert progress_after_second[0]["label"] == "Generating resume"
    assert progress_after_second[1]["step"] == "cover_letter"
    assert progress_after_second[1]["label"] == "Generating cover letter"
    # First entry is carried through unchanged, not re-stamped.
    assert progress_after_second[0]["at"] == progress_after_first[0]["at"]


# ── HUNT2 P3 S6: board health + feeder cursors ───────────────────────────


def test_list_board_catalog_rows_selects_widened_columns(patch_db_client):
    fake = _FakeClient({"board_catalog": [{"id": "b1", "ats": "greenhouse", "slug": "acme"}]})
    patch_db_client(fake)

    db.list_board_catalog_rows()

    query = fake.queries[-1][1]
    assert query._mode == "select"


def test_update_board_catalog_status_writes_expected_payload(patch_db_client):
    fake = _FakeClient({"board_catalog": [{"id": "b1"}]})
    patch_db_client(fake)

    db.update_board_catalog_status("b1", "dead")

    query = fake.queries[-1][1]
    assert query.update_payload == {"status": "dead"}
    assert query.eq_calls == [("id", "b1")]


def test_upsert_board_health_row_writes_expected_payload_and_on_conflict(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.upsert_board_health_row(
        board_id="b1", day="2026-07-21", http_status=200, posting_count=3, name_check_ok=True,
    )

    query = fake.queries[-1][1]
    assert query.upsert_payload == {
        "board_id": "b1", "day": "2026-07-21", "http_status": 200,
        "posting_count": 3, "name_check_ok": True,
    }
    assert query.upsert_on_conflict == "board_id,day"


def test_has_nonzero_board_health_baseline_true_when_any_row_nonzero(patch_db_client):
    fake = _FakeClient({"board_health": [
        {"board_id": "b1", "posting_count": 0}, {"board_id": "b1", "posting_count": 5},
    ]})
    patch_db_client(fake)

    assert db.has_nonzero_board_health_baseline("b1", "2026-04-22") is True


def test_has_nonzero_board_health_baseline_false_when_all_zero(patch_db_client):
    fake = _FakeClient({"board_health": [
        {"board_id": "b1", "posting_count": 0}, {"board_id": "b1", "posting_count": None},
    ]})
    patch_db_client(fake)

    assert db.has_nonzero_board_health_baseline("b1", "2026-04-22") is False


def test_has_nonzero_board_health_baseline_false_when_no_rows(patch_db_client):
    fake = _FakeClient({"board_health": []})
    patch_db_client(fake)

    assert db.has_nonzero_board_health_baseline("b1", "2026-04-22") is False


def test_get_feeder_cursor_returns_none_when_never_run(patch_db_client):
    fake = _FakeClient({"feeder_cursors": []})
    patch_db_client(fake)

    assert db.get_feeder_cursor("aggregator") is None


def test_get_feeder_cursor_returns_stored_value(patch_db_client):
    fake = _FakeClient({"feeder_cursors": [{"feeder": "aggregator", "cursor_at": "2026-07-01T00:00:00Z"}]})
    patch_db_client(fake)

    assert db.get_feeder_cursor("aggregator") == "2026-07-01T00:00:00Z"


def test_set_feeder_cursor_writes_expected_payload_and_on_conflict(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    db.set_feeder_cursor("aggregator", "2026-07-21T00:00:00Z")

    query = fake.queries[-1][1]
    assert query.upsert_payload["feeder"] == "aggregator"
    assert query.upsert_payload["cursor_at"] == "2026-07-21T00:00:00Z"
    assert query.upsert_on_conflict == "feeder"


def test_list_non_title_rejected_matches_without_cursor_reads_everything(patch_db_client):
    fake = _FakeClient({"matches": [
        {"posting_id": "p1", "status": "surfaced", "created_at": "2026-01-01T00:00:00Z"},
        {"posting_id": "p2", "status": "rejected_title", "created_at": "2026-01-02T00:00:00Z"},
    ]})
    patch_db_client(fake)

    rows = db.list_non_title_rejected_matches()

    assert [r["posting_id"] for r in rows] == ["p1"]
    query = fake.queries[-1][1]
    assert query.gte_calls == []


def test_list_non_title_rejected_matches_with_cursor_issues_gt_filter(patch_db_client):
    fake = _FakeClient({"matches": [{"posting_id": "p1", "status": "surfaced", "created_at": "2026-01-02T00:00:00Z"}]})
    patch_db_client(fake)

    db.list_non_title_rejected_matches(since="2026-01-01T00:00:00Z")

    query = fake.queries[-1][1]
    assert query.gt_calls == [("created_at", "2026-01-01T00:00:00Z")]
