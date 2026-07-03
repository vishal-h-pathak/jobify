"""jobify.hosted.embed — Voyage embeddings for postings + profiles (H4 Task 2).

Provider: Voyage AI, `voyage-3.5-lite` (confirmed via Voyage's docs,
2026-07: `voyage-3.5-lite`, along with `voyage-4-large`/`voyage-4`/
`voyage-4-lite`/`voyage-3-large`/`voyage-3.5`/`voyage-code-3`, supports an
explicit `output_dimension` parameter with valid values `{256, 512, 1024,
2048}`, default 1024). We request `output_dimension=1024` explicitly so it
matches the existing `vector(1024)` columns on `profiles.embedding` and
`postings.embedding` (`jobify/migrations/0002_multitenant.sql`) — no
dimension-altering migration needed. Pricing: $0.02 / 1M input tokens
(first 200M tokens free); see `docs/SCORING.md` stage-3 for the amortized
per-posting cost estimate.

Degradation contract: embeddings are OFF — cleanly skipped, no exception,
no network call attempted — whenever `EMBEDDINGS_ENABLED` is false OR
`VOYAGE_API_KEY` is empty (`jobify.config`). The scoring ladder must work
end-to-end (stage 1 -> 2 -> 4, stage 3 skipped) in that state; every
public function here reports "disabled" via its return value (`None` /
`False`) rather than raising, so Task 3's fan-out can branch on that
cleanly.

Two embedding "shapes" this module serves:
    - Postings are GLOBAL and shared: `ensure_posting_embedding` computes
      one exactly once (skips if `postings.embedding` is already set) and
      records the cost with `user_id=None` on the `budget_ledger` row — no
      single user owns a cost every user's match benefits from.
    - Profiles are per-user: `ensure_profile_embedding` recomputes only
      when the caller passes `force=True` (or the row has no embedding
      yet). Deciding WHEN to force a recompute (e.g. the profile's
      `updated_at` moved since the embedding was last written) is left to
      Task 3's fan-out, which already re-materializes the profile each
      cycle and knows whether the doc changed — this module just executes
      the "recompute or not" decision it's handed. The ledger row uses the
      specific `user_id` (it's that user's own profile).
"""

from __future__ import annotations

import logging

from jobify import db
from jobify.config import EMBEDDINGS_ENABLED, VOYAGE_API_KEY

logger = logging.getLogger("jobify.hosted.embed")

MODEL = "voyage-3.5-lite"
OUTPUT_DIMENSION = 1024
EMBED_EVENT = "embedding"

# Voyage's published price for voyage-3.5-lite: $0.02 / 1,000,000 input
# tokens (no separate output-token cost for embeddings). Used only to
# populate the budget_ledger row's cost_usd; token counts themselves come
# straight from the API response (`total_tokens`), never estimated.
_COST_PER_TOKEN_USD = 0.02 / 1_000_000

_client = None


def embeddings_enabled() -> bool:
    """True when embeddings should run: `EMBEDDINGS_ENABLED` is truthy AND
    `VOYAGE_API_KEY` is non-empty. Both `jobify.config` reads are soft
    defaults (enabled-by-default flag, empty-string key), so a fresh
    checkout with no Voyage key configured resolves this to `False`
    without raising anywhere.
    """
    return bool(EMBEDDINGS_ENABLED) and bool(VOYAGE_API_KEY.strip())


def _get_client():
    """Lazily construct the Voyage SDK client. Lazy import (matches
    `jobify.db._get_client`'s pattern for the Supabase SDK) so this module
    stays importable in environments without network credentials — every
    call site checks `embeddings_enabled()` before this is ever reached.
    """
    global _client
    if _client is None:
        import voyageai  # noqa: PLC0415 — lazy, optional at import time

        _client = voyageai.Client(api_key=VOYAGE_API_KEY)
    return _client


def _embed_raw(texts: list[str]) -> tuple[list[list[float]], int] | None:
    """Low-level Voyage call shared by `embed_texts` and the `ensure_*`
    helpers below. Returns `(embeddings, total_tokens)`, or `None` when
    embeddings are disabled. `texts=[]` short-circuits to `([], 0)` without
    an API call — Voyage's API doesn't accept an empty batch.
    """
    if not embeddings_enabled():
        return None
    if not texts:
        return [], 0
    result = _get_client().embed(
        texts=texts,
        model=MODEL,
        input_type="document",
        output_dimension=OUTPUT_DIMENSION,
    )
    return list(result.embeddings), int(result.total_tokens or 0)


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    """Raw embedding call: one Voyage vector per input text, in order.

    Returns `None` (not an empty list) when embeddings are disabled, so
    callers can distinguish "disabled" from "got zero results" — an empty
    list means `texts` was empty while embeddings were enabled. Does NOT
    write a budget_ledger row itself (it has no `posting_id`/`user_id` to
    attribute the cost to); `ensure_posting_embedding` /
    `ensure_profile_embedding` below own that bookkeeping.
    """
    result = _embed_raw(texts)
    if result is None:
        return None
    embeddings, _total_tokens = result
    return embeddings


def _cost_usd(total_tokens: int) -> float:
    return round(total_tokens * _COST_PER_TOKEN_USD, 6)


def ensure_posting_embedding(posting_id: str, text: str) -> bool:
    """Compute and store `posting_id`'s embedding if it doesn't already
    have one. Postings are global/shared — this must only ever compute
    ONE embedding per posting, not one per user who happens to match
    against it.

    Returns `True` if an embedding was computed and stored, `False` if
    embeddings are disabled, the posting already had one, or the API call
    produced nothing. Writes an `event='embedding'` budget_ledger row with
    `user_id=None` on success (a global, unattributed cost —
    `0004_worker.sql` drops `budget_ledger.user_id`'s NOT NULL for exactly
    this case).
    """
    if not embeddings_enabled():
        return False
    if db.get_posting_embedding(posting_id) is not None:
        return False

    result = _embed_raw([text])
    if result is None:
        return False
    embeddings, total_tokens = result
    if not embeddings:
        logger.warning(
            "embed: posting_id=%s got no embedding back from Voyage", posting_id
        )
        return False

    db.set_posting_embedding(posting_id, embeddings[0])
    db.insert_budget_ledger_row(
        None, EMBED_EVENT,
        model=MODEL, input_tokens=total_tokens, cost_usd=_cost_usd(total_tokens),
    )
    return True


def ensure_profile_embedding(user_id: str, text: str, *, force: bool = False) -> bool:
    """Compute and store `user_id`'s profile embedding.

    Unlike postings, profile embeddings are per-user and their source text
    changes over time (profile edits) — so this only skips when an
    embedding already exists AND `force` is `False`. Pass `force=True` when
    the caller (Task 3's fan-out) has already determined the profile
    changed since the last embedding (e.g. by comparing
    `profiles.updated_at` against its own bookkeeping) and wants a fresh
    vector regardless of what's stored.

    Returns `True` if an embedding was computed and stored, `False`
    otherwise (disabled, skipped because unforced + already present, or
    the API call produced nothing). Writes an `event='embedding'`
    budget_ledger row with this specific `user_id` on success — it's that
    user's own profile, not a shared cost.
    """
    if not embeddings_enabled():
        return False
    if not force and db.get_profile_embedding(user_id) is not None:
        return False

    result = _embed_raw([text])
    if result is None:
        return False
    embeddings, total_tokens = result
    if not embeddings:
        logger.warning(
            "embed: user_id=%s got no embedding back from Voyage", user_id
        )
        return False

    db.set_profile_embedding(user_id, embeddings[0])
    db.insert_budget_ledger_row(
        user_id, EMBED_EVENT,
        model=MODEL, input_tokens=total_tokens, cost_usd=_cost_usd(total_tokens),
    )
    return True
