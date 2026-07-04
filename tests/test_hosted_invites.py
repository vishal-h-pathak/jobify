"""tests/test_hosted_invites.py — jobify.hosted.invites (H7 Launch Part A
Task 3).

Chainable Supabase double, replicated locally (a minimal subset of
`tests/test_db_hosted.py`'s `_FakeClient`/`_FakeQuery`/`_FakeResult` —
importing fixtures from a sibling test module isn't this codebase's
convention, and the subset needed here is small: `.table().insert()` /
`.select().execute()`, no `.eq()`/`.gte()` filtering). Wired in via the
shared `patch_db_client` fixture (`tests/conftest.py`) — no live
Supabase.
"""

from __future__ import annotations

import sys

from jobify.hosted import invites


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Mimics ``client.table(...).select|insert.execute()`` — the only
    two operations `jobify.hosted.invites` calls."""

    def __init__(self, rows: list[dict]):
        self._rows = list(rows)
        self._mode: str | None = None
        self.insert_payload: dict | None = None

    def select(self, *_a, **_k):
        self._mode = "select"
        return self

    def insert(self, payload):
        self._mode = "insert"
        self.insert_payload = payload
        return self

    def execute(self):
        if self._mode == "insert":
            self._rows.append(dict(self.insert_payload))
            return _FakeResult([])
        return _FakeResult(list(self._rows))


class _FakeClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self._tables = tables or {}
        self.queries: list[tuple[str, _FakeQuery]] = []

    def table(self, name):
        q = _FakeQuery(self._tables.setdefault(name, []))
        self.queries.append((name, q))
        return q


# ── mint_invites ──────────────────────────────────────────────────────────


def test_mint_invites_returns_distinct_lowercase_codes(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    codes = invites.mint_invites(3)

    assert len(codes) == 3
    assert len(set(codes)) == 3
    assert all(code == code.lower() for code in codes)


def test_mint_invites_inserts_each_code_as_a_row(patch_db_client):
    fake = _FakeClient()
    patch_db_client(fake)

    codes = invites.mint_invites(3)

    insert_queries = [q for name, q in fake.queries if name == "invites"]
    assert len(insert_queries) == 3
    inserted_codes = [q.insert_payload["code"] for q in insert_queries]
    assert sorted(inserted_codes) == sorted(codes)


def test_mint_invites_leaves_created_by_unset(patch_db_client):
    """CLI mint has no minting user to attribute the row to — only
    `code` should be set."""
    fake = _FakeClient()
    patch_db_client(fake)

    invites.mint_invites(1)

    _, q = fake.queries[-1]
    assert set(q.insert_payload.keys()) == {"code"}


# ── list_invites ──────────────────────────────────────────────────────────


def test_list_invites_returns_seeded_rows(patch_db_client):
    fake = _FakeClient({
        "invites": [
            {
                "code": "abc123",
                "created_by": None,
                "claimed_by": "user-1",
                "claimed_at": "2026-07-01T00:00:00Z",
                "created_at": "2026-06-30T00:00:00Z",
            },
            {
                "code": "def456",
                "created_by": None,
                "claimed_by": None,
                "claimed_at": None,
                "created_at": "2026-06-29T00:00:00Z",
            },
        ]
    })
    patch_db_client(fake)

    rows = invites.list_invites()

    assert {r["code"] for r in rows} == {"abc123", "def456"}


def test_list_invites_empty_table(patch_db_client):
    fake = _FakeClient({"invites": []})
    patch_db_client(fake)

    assert invites.list_invites() == []


# ── run() ────────────────────────────────────────────────────────────────


def test_run_mint_prints_codes_one_per_line(patch_db_client, monkeypatch, capsys):
    fake = _FakeClient()
    patch_db_client(fake)
    monkeypatch.setattr(sys, "argv", ["jobify-hosted-invite", "--mint", "2"])

    invites.run()

    printed_lines = [l for l in capsys.readouterr().out.splitlines() if l]
    assert len(printed_lines) == 2
    assert all(line == line.lower() for line in printed_lines)


def test_run_list_prints_claim_status(patch_db_client, monkeypatch, capsys):
    fake = _FakeClient({
        "invites": [
            {
                "code": "abc123",
                "created_by": None,
                "claimed_by": "user-1",
                "claimed_at": "2026-07-01T00:00:00Z",
                "created_at": "2026-06-30T00:00:00Z",
            },
            {
                "code": "def456",
                "created_by": None,
                "claimed_by": None,
                "claimed_at": None,
                "created_at": "2026-06-29T00:00:00Z",
            },
        ]
    })
    patch_db_client(fake)
    monkeypatch.setattr(sys, "argv", ["jobify-hosted-invite", "--list"])

    invites.run()

    printed = capsys.readouterr().out
    assert "abc123" in printed
    assert "user-1" in printed
    assert "def456" in printed
    assert "unclaimed" in printed


def test_run_with_neither_flag_exits_nonzero(patch_db_client, monkeypatch):
    fake = _FakeClient()
    patch_db_client(fake)
    monkeypatch.setattr(sys, "argv", ["jobify-hosted-invite"])

    try:
        invites.run()
        raised = False
    except SystemExit as exc:
        raised = True
        assert exc.code != 0

    assert raised
