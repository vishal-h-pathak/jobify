"""tests/test_db_hosted.py — jobify.db's H4 additions.

`set_profile_validation_status`, `insert_budget_ledger_row`,
`get_month_to_date_spend`, `get_budget_cap`: the profile-validation write
and budget-ledger read/write helpers Task 2/3 (embeddings, rubric
compile, LLM verdict, the stage-4 budget check) call. Chainable Supabase
double, mirroring `tests/test_manual_upsert.py` / `tests/test_rescore.py`'s
pattern. Wired in via the shared `patch_db_client` fixture
(`tests/conftest.py`) — no live Supabase.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from jobify import db


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Mimics ``client.table(...).select|insert|update|eq|gte|execute()``.

    ``eq()`` filters the backing rows (needed so the spend-sum test only
    sees one user's rows); ``gte()`` only records its call, matching
    ``tests/test_rescore.py``'s fake (this module's date filtering is a
    server-side concern the fake doesn't need to reimplement).
    """

    def __init__(self, rows: list[dict]):
        self._rows = list(rows)
        self._mode: str | None = None
        self.insert_payload: dict | None = None
        self.update_payload: dict | None = None
        self.eq_calls: list[tuple[str, object]] = []
        self.gte_calls: list[tuple[str, object]] = []

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

    def eq(self, col, val):
        self.eq_calls.append((col, val))
        self._rows = [r for r in self._rows if r.get(col) == val]
        return self

    def gte(self, col, val):
        self.gte_calls.append((col, val))
        return self

    def execute(self):
        if self._mode in ("insert", "update"):
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

    db.set_profile_validation_status("user-1", "invalid")

    name, q = fake.queries[-1]
    assert name == "profiles"
    assert q.update_payload == {"validation_status": "invalid"}
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
    }


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
    }


# ── get_month_to_date_spend ──────────────────────────────────────────────


def test_get_month_to_date_spend_sums_only_this_users_rows(patch_db_client):
    fake = _FakeClient({
        "budget_ledger": [
            {"user_id": "user-1", "cost_usd": 1.5},
            {"user_id": "user-1", "cost_usd": 2.25},
            {"user_id": "user-2", "cost_usd": 99.0},
        ]
    })
    patch_db_client(fake)

    assert db.get_month_to_date_spend("user-1") == pytest.approx(3.75)


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
