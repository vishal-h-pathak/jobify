"""sources/query_gen.py — per-user, LLM-generated paid-search queries
(HUNT2 P2 §4.3, session 53/S5).

`query_templates.py`'s `build_queries_for_profile` (P0.6) is a zero-LLM
template: top-3 targeting-tier titles x remote/metro, verbatim. Fast and
free, but mechanical — it only ever emits the tier LABELS a user typed,
never the synonyms a recruiter's ATS actually indexes under. This module
is the permanent replacement: ONE metered LLM call per user per ~30 days
(or when their compiled rubric changes) generates a richer query set from
THE COMPILED RUBRIC (`jobify.hunt.rubric.compile_rubric`'s output) — not
the raw profile, since the rubric is the candidate's own distilled
judgment, already paid for once.

Storage: `search_queries.json`, a sibling file inside the per-user cache
dir `jobify.profile_loader.materialize_profile_dir` already maintains
(deliberately NOT one of the 8 `DOC_FILENAMES` — this is a generated
cache artifact, not a user-authored document) AND mirrored into
`profiles.doc["search_queries.json"]` via `jobify.db.update_profile_doc_file`
so a wiped/relocated cache recovers the last generation instead of losing
a $-metered call.

Freshness (owner directive, HUNT2 S5 review — Rider A): the common path
must cost ZERO database round-trips, because the caller is
`profile_loader.materialize_profile_dir`, which fires on every profile
read across hunt/tailor/fanout, not just discovery. `ensure_user_queries`
therefore checks the stored file's `generated_at` FIRST — a pure
file-stat + JSON-parse — and only falls through to a DB-backed generation
attempt (guarded by a 24h runaway cap on the `query_gen` ledger event)
when that file is missing or has aged past `FRESHNESS_DAYS`. A rubric
change mid-window is deliberately NOT detected until the file naturally
expires by age — an explicit tradeoff for the zero-DB common path, not an
oversight.

HUNT2 wave C wiring debt (Rider B, session 55 review): the natural home
for the `ensure_user_queries` call is
`jobify.hosted.discovery._union_profiles` — it already iterates
`(user_id, profile_dir)` pairs for exactly this purpose, and hooking it
there (rather than inside `profile_loader.materialize_profile_dir`, which
every OTHER subtree also calls) would mean only discovery pays even the
file-stat. It lives in `profile_loader.py` instead ONLY because
`discovery.py` was off-limits this wave (session 54 was mid-edit on it
this same cycle). Relocating the one call, once that collision window
closes, moves zero storage/generation logic — just which function fires
it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from jobify import db
from jobify.hunt.prompts import load_prompt
from jobify.hunt.rubric import _extract_json_object
from jobify.shared import llm

logger = logging.getLogger("sources.query_gen")

QUERY_GEN_EVENT = "query_gen"
STORAGE_FILENAME = "search_queries.json"

FRESHNESS_DAYS = 30
RUNAWAY_GUARD_HOURS = 24
MAX_QUERIES = 10

# Haiku-class — a mechanical combinatorial task (title synonyms x
# seniority x location), same tier as jobify.hosted.fanout's STAGE4_MODEL,
# run at most once per user per ~30 days.
GENERATOR_MODEL = "claude-haiku-4-5"
GENERATOR_MAX_TOKENS = 1024

# Pricing, USD per million tokens — same env-tunable-constant convention
# jobify.hosted.fanout uses for its own Haiku-class call (STAGE4_*).
# Duplicated rather than imported: jobify.hunt must not depend on
# jobify.hosted.
GENERATOR_INPUT_USD_PER_MTOK = float(
    os.environ.get("QUERY_GEN_INPUT_USD_PER_MTOK", "1.0")
)
GENERATOR_OUTPUT_USD_PER_MTOK = float(
    os.environ.get("QUERY_GEN_OUTPUT_USD_PER_MTOK", "5.0")
)


def _cost_usd(input_tokens: int, output_tokens: int) -> float:
    return round(
        input_tokens / 1_000_000 * GENERATOR_INPUT_USD_PER_MTOK
        + output_tokens / 1_000_000 * GENERATOR_OUTPUT_USD_PER_MTOK,
        6,
    )


def _fingerprint(rubric: dict) -> str:
    """Stable hash of a compiled rubric — stored alongside a generated
    batch as a record of what it was generated against. NOT consulted by
    `_is_fresh` (see module docstring, Rider A): recomputing it would
    require a DB read on every call, defeating the zero-DB common path.
    """
    return hashlib.sha256(
        json.dumps(rubric, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _storage_path(profile_dir: Path) -> Path:
    return profile_dir / STORAGE_FILENAME


def _load_stored(profile_dir: Path) -> Optional[dict]:
    """Read+parse `search_queries.json`, or `None` if missing/malformed."""
    path = _storage_path(profile_dir)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    if not isinstance(data.get("queries"), list) or not isinstance(
        data.get("generated_at"), str
    ):
        return None
    return data


def _is_fresh(stored: dict) -> bool:
    try:
        generated_at = datetime.fromisoformat(
            str(stored["generated_at"]).replace("Z", "+00:00")
        )
    except (ValueError, TypeError):
        return False
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - generated_at < timedelta(days=FRESHNESS_DAYS)


def _write_stored(
    profile_dir: Path, user_id: str, queries: list[str], fingerprint: str
) -> None:
    record = {
        "queries": queries,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rubric_fingerprint": fingerprint,
    }
    text = json.dumps(record)
    _storage_path(profile_dir).write_text(text, encoding="utf-8")
    try:
        db.update_profile_doc_file(user_id, STORAGE_FILENAME, text)
    except Exception as exc:  # noqa: BLE001 — the on-disk copy already
        # serves this process; a DB mirror hiccup is logged, not fatal.
        logger.warning(
            "query_gen: failed to persist %s to profiles.doc for "
            "user_id=%s: %s", STORAGE_FILENAME, user_id, exc,
        )


def _generator_system() -> str:
    return load_prompt("query_gen")


def _generator_user_msg(rubric: dict) -> str:
    return (
        "=== compiled rubric (tier_hints, term_groups, gates.location) ===\n"
        f"{json.dumps(rubric, indent=2, sort_keys=True)}\n"
    )


def _validate_queries(data: object) -> list[str]:
    if not isinstance(data, dict):
        raise ValueError("response is not a JSON object")
    queries = data.get("queries")
    if not isinstance(queries, list) or not queries:
        raise ValueError("'queries' must be a non-empty list")
    cleaned = [q.strip() for q in queries if isinstance(q, str) and q.strip()]
    if not cleaned:
        raise ValueError("'queries' contained no usable strings")
    return cleaned[:MAX_QUERIES]


def _generate(user_id: str, rubric: dict) -> Optional[list[str]]:
    """One metered LLM call, retried once (a fresh call, not a repair
    prompt — mirrors `jobify.hunt.rubric.compile_rubric`), guarded by a
    24h per-user runaway cap on the `query_gen` ledger event.

    Returns `None` on ANY failure — guard tripped, no usable auth,
    transient API error, invalid JSON, empty/unusable result after the
    retry — so the caller falls back to P0.6 templates. Deliberately
    broader than `compile_rubric`'s own catch (which lets an LLM-call
    exception propagate to its single, purpose-built caller): this
    function's caller (`profile_loader.materialize_profile_dir`, via
    `ensure_user_queries`) is a hook fired from dozens of unrelated call
    sites across the whole pipeline and must never surface a raw
    exception. Nothing is cached on failure, per spec.
    """
    if db.has_recent_ledger_event(
        user_id, QUERY_GEN_EVENT, hours=RUNAWAY_GUARD_HOURS
    ):
        logger.info(
            "query_gen: skipping generation for user_id=%s — a %s ledger "
            "row already landed within %dh", user_id, QUERY_GEN_EVENT,
            RUNAWAY_GUARD_HOURS,
        )
        return None

    user_msg = _generator_user_msg(rubric)
    last_error: Optional[str] = None
    total_input = 0
    total_output = 0
    for _attempt in range(2):
        try:
            text, usage = llm.complete_with_usage(
                system=_generator_system(),
                prompt=user_msg,
                model=GENERATOR_MODEL,
                max_tokens=GENERATOR_MAX_TOKENS,
            )
        except Exception as exc:  # noqa: BLE001 — see docstring
            last_error = f"llm call failed: {exc}"
            continue
        total_input += usage.input_tokens
        total_output += usage.output_tokens
        try:
            queries = _validate_queries(_extract_json_object(text))
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = f"invalid response: {exc}"
            continue

        db.insert_budget_ledger_row(
            user_id, QUERY_GEN_EVENT,
            model=GENERATOR_MODEL,
            input_tokens=total_input, output_tokens=total_output,
            cost_usd=_cost_usd(total_input, total_output),
        )
        return queries

    logger.warning(
        "query_gen: generation failed for user_id=%s after retry: %s",
        user_id, last_error,
    )
    return None


def ensure_user_queries(
    user_id: str, profile_dir: Path, compiled_rubric: Optional[dict],
) -> Optional[list[str]]:
    """Return this user's LLM-generated paid-search queries, refreshing
    them (one metered call) only when the stored batch has aged past
    `FRESHNESS_DAYS` or never existed. `None` means "nothing usable yet —
    caller falls back to the P0.6 templates."

    `compiled_rubric` is the CALLER's already-fetched
    `profiles.compiled_rubric` value — `materialize_profile_dir` fetches
    the whole `profiles` row unconditionally on every call anyway, so
    passing it through here means the slow path costs exactly one extra
    DB round-trip (the 24h ledger guard inside `_generate`), not two. See
    module docstring for the fast-path (zero-DB) design.
    """
    stored = _load_stored(profile_dir)
    if stored is not None and _is_fresh(stored):
        return stored["queries"]

    if not compiled_rubric:
        return None  # nothing compiled yet for this user — too early to generate

    fingerprint = _fingerprint(compiled_rubric)
    queries = _generate(user_id, compiled_rubric)
    if not queries:
        return None

    _write_stored(profile_dir, user_id, queries, fingerprint)
    return queries
