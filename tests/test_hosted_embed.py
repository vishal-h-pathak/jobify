"""tests/test_hosted_embed.py — jobify.hosted.embed (H4 Task 2).

Voyage embeddings for postings (global, computed once) and profiles
(per-user). No network: `_get_client()` is monkeypatched to a fake Voyage
client, and `jobify.db`'s read/write helpers are monkeypatched directly
(no live Supabase) — matching `tests/test_db_hosted.py`'s convention for
this module's sibling.
"""

from __future__ import annotations

import pytest

from jobify import db
from jobify.hosted import embed


class _FakeVoyageResult:
    def __init__(self, embeddings, total_tokens):
        self.embeddings = embeddings
        self.total_tokens = total_tokens


class _FakeVoyageClient:
    def __init__(self, embeddings=None, total_tokens=42):
        self._embeddings = embeddings if embeddings is not None else [[0.1] * 1024]
        self._total_tokens = total_tokens
        self.embed_calls: list[dict] = []

    def embed(self, texts, model, input_type, output_dimension):
        self.embed_calls.append({
            "texts": list(texts), "model": model,
            "input_type": input_type, "output_dimension": output_dimension,
        })
        return _FakeVoyageResult(self._embeddings[: len(texts)], self._total_tokens)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Every test gets a clean lazy-client cache so fakes from one test
    never leak into the next."""
    monkeypatch.setattr(embed, "_client", None)
    yield
    monkeypatch.setattr(embed, "_client", None)


def _enable(monkeypatch, key="fake-voyage-key", enabled=True):
    monkeypatch.setattr(embed, "VOYAGE_API_KEY", key)
    monkeypatch.setattr(embed, "EMBEDDINGS_ENABLED", enabled)


def _disable_via_flag(monkeypatch):
    monkeypatch.setattr(embed, "VOYAGE_API_KEY", "fake-voyage-key")
    monkeypatch.setattr(embed, "EMBEDDINGS_ENABLED", False)


def _disable_via_missing_key(monkeypatch):
    monkeypatch.setattr(embed, "VOYAGE_API_KEY", "")
    monkeypatch.setattr(embed, "EMBEDDINGS_ENABLED", True)


def _boom_client():
    raise AssertionError("must not construct a Voyage client while disabled")


# ── embeddings_enabled() ──────────────────────────────────────────────────


def test_enabled_requires_both_flag_and_key(monkeypatch):
    _enable(monkeypatch)
    assert embed.embeddings_enabled() is True


def test_disabled_when_flag_false(monkeypatch):
    _disable_via_flag(monkeypatch)
    assert embed.embeddings_enabled() is False


def test_disabled_when_key_empty(monkeypatch):
    _disable_via_missing_key(monkeypatch)
    assert embed.embeddings_enabled() is False


def test_disabled_when_key_whitespace_only(monkeypatch):
    monkeypatch.setattr(embed, "VOYAGE_API_KEY", "   ")
    monkeypatch.setattr(embed, "EMBEDDINGS_ENABLED", True)
    assert embed.embeddings_enabled() is False


# ── embed_texts: off-degradation (no exception, no network) ──────────────


def test_embed_texts_returns_none_when_flag_false_no_network(monkeypatch):
    _disable_via_flag(monkeypatch)
    monkeypatch.setattr(embed, "_get_client", _boom_client)

    assert embed.embed_texts(["hello"]) is None


def test_embed_texts_returns_none_when_key_empty_no_network(monkeypatch):
    _disable_via_missing_key(monkeypatch)
    monkeypatch.setattr(embed, "_get_client", _boom_client)

    assert embed.embed_texts(["hello"]) is None


def test_embed_texts_empty_list_when_enabled_returns_empty_not_none(monkeypatch):
    """Disambiguates 'disabled' (None) from 'nothing to embed' ([])."""
    _enable(monkeypatch)
    monkeypatch.setattr(embed, "_get_client", _boom_client)  # must not be reached either

    assert embed.embed_texts([]) == []


def test_embed_texts_calls_voyage_with_1024_dim_and_returns_vectors(monkeypatch):
    _enable(monkeypatch)
    fake_client = _FakeVoyageClient(embeddings=[[0.5, 0.6]])
    monkeypatch.setattr(embed, "_get_client", lambda: fake_client)

    result = embed.embed_texts(["posting text"])

    assert result == [[0.5, 0.6]]
    assert fake_client.embed_calls == [{
        "texts": ["posting text"], "model": "voyage-3.5-lite",
        "input_type": "document", "output_dimension": 1024,
    }]


# ── ensure_posting_embedding ───────────────────────────────────────────────


def _boom_db(*_a, **_k):
    raise AssertionError("must not touch the DB while disabled")


def test_ensure_posting_embedding_noop_when_disabled(monkeypatch):
    _disable_via_flag(monkeypatch)
    monkeypatch.setattr(embed, "_get_client", _boom_client)
    monkeypatch.setattr(db, "get_posting_embedding", _boom_db)

    assert embed.ensure_posting_embedding("posting-1", "text") is False


def test_ensure_posting_embedding_skips_when_already_present(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(db, "get_posting_embedding", lambda pid: [0.1] * 1024)
    monkeypatch.setattr(embed, "_get_client", _boom_client)  # must not be reached

    assert embed.ensure_posting_embedding("posting-1", "text") is False


def test_ensure_posting_embedding_computes_stores_and_ledgers_with_null_user(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(db, "get_posting_embedding", lambda pid: None)
    fake_client = _FakeVoyageClient(embeddings=[[0.9, 0.8]], total_tokens=50_000)
    monkeypatch.setattr(embed, "_get_client", lambda: fake_client)

    stored: dict = {}
    monkeypatch.setattr(
        db, "set_posting_embedding",
        lambda pid, vec: stored.update(posting_id=pid, vec=vec),
    )
    ledger_calls: list[tuple] = []
    monkeypatch.setattr(
        db, "insert_budget_ledger_row",
        lambda user_id, event, **kw: ledger_calls.append((user_id, event, kw)),
    )

    assert embed.ensure_posting_embedding("posting-1", "posting text") is True
    assert stored == {"posting_id": "posting-1", "vec": [0.9, 0.8]}
    assert len(ledger_calls) == 1
    user_id, event, kw = ledger_calls[0]
    assert user_id is None  # global, unattributed cost
    assert event == "embedding"
    assert kw["model"] == "voyage-3.5-lite"
    assert kw["input_tokens"] == 50_000
    assert kw["cost_usd"] == pytest.approx(50_000 * 0.02 / 1_000_000)


# ── ensure_profile_embedding ────────────────────────────────────────────────


def test_ensure_profile_embedding_noop_when_disabled(monkeypatch):
    _disable_via_missing_key(monkeypatch)
    monkeypatch.setattr(embed, "_get_client", _boom_client)

    assert embed.ensure_profile_embedding("user-1", "profile text") is False


def test_ensure_profile_embedding_skips_when_present_and_not_forced(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(db, "get_profile_embedding", lambda uid: [0.1] * 1024)
    monkeypatch.setattr(embed, "_get_client", _boom_client)

    assert embed.ensure_profile_embedding("user-1", "profile text") is False


def test_ensure_profile_embedding_force_recomputes_even_when_present(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(db, "get_profile_embedding", lambda uid: [0.1] * 1024)
    fake_client = _FakeVoyageClient(embeddings=[[0.3, 0.4]], total_tokens=9)
    monkeypatch.setattr(embed, "_get_client", lambda: fake_client)

    stored: dict = {}
    monkeypatch.setattr(
        db, "set_profile_embedding",
        lambda uid, vec: stored.update(user_id=uid, vec=vec),
    )
    ledger_calls: list[tuple] = []
    monkeypatch.setattr(
        db, "insert_budget_ledger_row",
        lambda user_id, event, **kw: ledger_calls.append((user_id, event, kw)),
    )

    assert embed.ensure_profile_embedding("user-1", "profile text", force=True) is True
    assert stored == {"user_id": "user-1", "vec": [0.3, 0.4]}
    assert len(ledger_calls) == 1
    user_id, event, kw = ledger_calls[0]
    assert user_id == "user-1"  # attributed to the profile's own owner
    assert event == "embedding"
    assert kw["input_tokens"] == 9


def test_ensure_profile_embedding_computes_when_absent_without_force(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(db, "get_profile_embedding", lambda uid: None)
    fake_client = _FakeVoyageClient(embeddings=[[0.2]], total_tokens=5)
    monkeypatch.setattr(embed, "_get_client", lambda: fake_client)
    monkeypatch.setattr(db, "set_profile_embedding", lambda uid, vec: None)
    monkeypatch.setattr(db, "insert_budget_ledger_row", lambda *a, **kw: None)

    assert embed.ensure_profile_embedding("user-1", "profile text") is True
