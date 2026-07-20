"""sources/query_templates.py — per-user query-template expansion for the
paid keyword-search sources (P0.6, HUNT2 session 47).

`jsearch.py` and `serpapi.py` used to run a fixed list of 8-12 hardcoded
query strings (one candidate's old search terms, baked into the source
module) against a hardcoded metro-or-remote location matrix. Neither
generalizes to a multi-user product: every hosted user got the SAME
queries regardless of what they're actually looking for. This module
replaces both with a small, zero-LLM template: each user's top ~3
targeting-tier titles, expanded by their own remote-acceptability and
base metro.

No LLM calls here — this is interim (P0.6's own acceptance criteria call
it out as such); the permanent replacement (rubric-derived queries, one
metered LLM call per user per month) is P2 (`planning/HUNT2_SOURCES.md`
§4.3), not this session.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("sources.query_templates")


def build_queries_for_profile(profile: dict) -> list[str]:
    """Top ~3 target titles from `profile.yml`'s targeting tiers, each
    expanded by remote-acceptability and/or base metro.

    `what_he_is_looking_for` tiers are sorted by key (`tier_1`, `tier_2`,
    ...) — same ordering convention `jobify.hosted.fanout.targeting_text`
    uses — and only the first three contribute a title. A title with
    neither a remote-acceptable flag nor a stated base metro still
    contributes one bare query (better than dropping the tier silently).
    """
    tiers = profile.get("what_he_is_looking_for")
    titles: list[str] = []
    if isinstance(tiers, dict):
        for key in sorted(tiers)[:3]:
            tier = tiers[key]
            if not isinstance(tier, dict):
                continue
            label = str(tier.get("label") or "").strip()
            if label:
                titles.append(label)

    loc = profile.get("location_and_compensation") or {}
    remote_acceptable = bool(loc.get("remote_acceptable"))
    base = str(loc.get("base") or "").strip()

    queries: list[str] = []
    for title in titles:
        suffixes = []
        if remote_acceptable:
            suffixes.append("remote")
        if base:
            suffixes.append(base)
        if not suffixes:
            queries.append(title)
        else:
            queries.extend(f"{title} {suffix}" for suffix in suffixes)
    return queries


def union_queries(
    profiles: list[dict], *, cap: int, provider: str = "",
) -> list[str]:
    """Union `build_queries_for_profile` across every user, deduped
    case-insensitively, capped at `cap` — the P0.6 acceptance test's
    "cap at 12 paid queries per provider per discovery run" (dedup
    happens BEFORE the cap so two users' identical query only ever costs
    one paid call). Anything dropped past the cap is logged, never
    silently discarded.
    """
    seen: set[str] = set()
    result: list[str] = []
    dropped = 0
    for profile in profiles:
        for q in build_queries_for_profile(profile):
            key = q.strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            if len(result) >= cap:
                dropped += 1
                continue
            result.append(q)
    if dropped:
        logger.info(
            "query_templates: dropped %d %s quer%s over cap=%d",
            dropped, provider or "query", "y" if dropped == 1 else "ies", cap,
        )
    return result


def queries_for_active_profile(profile_dir: Optional[Path] = None) -> list[str]:
    """Single-profile fallback for the CLI (`jobify-hunt`) call path:
    build queries from whichever ONE profile is currently active, via
    the process-global `profile_loader` resolution — the same profile
    the rest of the single-user pipeline already reads.

    `jsearch.fetch()`/`serpapi.fetch()` call this when invoked with no
    explicit `queries=` argument (i.e. every existing single-user call
    site) so the CLI stays personalized instead of reverting to a
    hardcoded, single-persona query list.
    """
    from jobify.profile_loader import load_profile, profile_dir as _profile_dir

    resolved = profile_dir if profile_dir is not None else _profile_dir()
    return build_queries_for_profile(load_profile(resolved))
