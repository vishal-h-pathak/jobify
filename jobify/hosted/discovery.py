"""jobify.hosted.discovery — global, once-per-cycle posting discovery (H4 Task 2).

The single-user pipeline (`jobify.hunt.agent`) runs one profile's
`portals.yml` boards every cycle. The hosted worker can't afford to repeat
that per user — two users watching the same Greenhouse company must
result in ONE fetch of that company, not two. This module:

    1. Lists every user with a `profiles` row (`jobify.db.list_profile_user_ids`).
    2. Materializes each user's profile (`jobify.profile_loader.materialize_profile_dir`)
       and reads their `portals.yml` boards via the dir-parameterized
       `companies()` / `workday_tenants()` helpers (`jobify.hunt.sources._portals`,
       Task 1).
    3. Unions those boards, deduped by portal slug (Greenhouse/Lever/Ashby)
       or (tenant, site, dc) (Workday) — first-seen display name/row wins.
    4. Fetches each board's postings exactly ONCE via the existing
       `jobify.hunt.sources.{greenhouse,lever,ashby,workday}` fetchers,
       reusing them directly rather than forking (each grew an optional
       `targets`/`tenants` override param in this task, additive and
       byte-compatible with the single-user `jobify-hunt` call). Each
       fetcher is also called with `apply_title_filter=False` — these
       four sources otherwise gate every posting through
       `passes_title_filter()`, which resolves through the
       process-global `_PORTALS_CACHE` for whichever ONE profile happens
       to be active (`jobify.hunt.sources._portals`). Applying that
       single profile's title/seniority preferences here would silently
       drop postings from the SHARED pool before any other hosted user
       ever saw them. Per-user title filtering is a scoring-stage concern
       and happens downstream, in Task 3's fan-out (Stage 1), against the
       full pool.
    4b. Also fetches the three non-portal, non-query `jobify.hunt.sources`
       fetchers (`hn_whoshiring`, `eighty_thousand_hours`, `remoteok`)
       exactly ONCE per cycle, zero-arg — they run a fixed keyword search
       with no per-user configuration to union, so there's nothing to
       materialize per user, but skipping them here would silently drop
       those sources' postings for every hosted user relative to what
       single-user `jobify-hunt` would have found.
    4c. `jsearch` and `serpapi` (paid, query-based) instead get the UNION
       of every user's per-user template queries (P0.6): top ~3 target
       titles per user's targeting tiers × remote/metro, deduped across
       users, capped at `_PAID_QUERY_CAP` per provider
       (`sources.query_templates.union_queries`). Replaces the old fixed,
       single-persona query list — every hosted user's own search terms
       now actually reach these two paid sources instead of one
       hardcoded list serving everyone identically.
    5. Resolves links via `jobify.hunt.agent._resolve_link_and_liveness`
       (reused directly — the four sources above only ever yield direct
       ATS URLs, so this never issues an extra HTTP fetch; see
       `jobify.tailor.url_resolver.is_ats_url`).
    6. Upserts into the GLOBAL `postings` pool (`jobify.db.upsert_posting`),
       keyed by `jobify.shared.jobid.make_job_id` — the same id scheme the
       single-user `jobs` table uses, so a posting already in the pool is
       a PK-conflict update (`last_seen_at` + link fields refreshed), not a
       duplicate row.

Zero LLM tokens spent anywhere in this module. Scoring (rubric / embedding
rerank / LLM verdict) is entirely Task 3's (`jobify.hosted.fanout`) job —
this module's only job is getting postings into the shared pool.

Covers all nine `jobify.hunt.sources` fetchers that the single-user
`jobify-hunt` pipeline (`jobify.hunt.agent.iter_all_jobs`) runs: the four
portals.yml-configured ATS sources (greenhouse/lever/ashby/workday) are
unioned per-user as described above; three keyword-search sources
(hn_whoshiring, eighty_thousand_hours, remoteok) have no per-user
configuration to union — every user would see an identical fetch — so
they're simply called once per cycle; jsearch/serpapi get the per-user
query-template union instead (P0.6, see module docstring §4c).
"""

from __future__ import annotations

import logging

from jobify import db
# Importing `_resolve_link_and_liveness` fully executes `jobify.hunt.agent`
# first, including its sys.path bootstrap (inserts `jobify/hunt/` so the
# intra-subtree `sources` package resolves as a top-level import) — so the
# `sources` imports below are safe even though `jobify/hosted/` itself was
# never added to that path.
from jobify.hunt.agent import _resolve_link_and_liveness
from jobify.profile_loader import load_profile, materialize_profile_dir
from sources import (
    ashby,
    eighty_thousand_hours,
    greenhouse,
    hn_whoshiring,
    jsearch,
    lever,
    remoteok,
    serpapi,
    workday,
)
from sources._portals import companies, workday_tenants
from sources.query_templates import union_queries

logger = logging.getLogger("jobify.hosted.discovery")

# Zero-config keyword-search sources: no per-user `portals.yml` (or query
# template) configuration to union — every user's fetch would be
# identical — so each is called exactly once per discovery cycle with no
# override.
_FIXED_SOURCES = (hn_whoshiring, eighty_thousand_hours, remoteok)

# P0.6 acceptance criterion: "cap at 12 paid queries per provider per
# discovery run." jsearch and serpapi each get their own cap off the same
# deduped query set (a query dropped for jsearch isn't necessarily dropped
# for serpapi — the cap is applied independently per provider).
_PAID_QUERY_CAP = 12


def _union_portal_targets(user_ids: list[str]) -> dict[str, list]:
    """Materialize every user's profile and union their `portals.yml`
    boards, deduped by portal identity (not by user).

    Greenhouse/Lever/Ashby dedup by `slug` (first-seen display `name`
    wins if two users' portals.yml disagree on the label for the same
    company). Workday dedup by `(tenant, site, dc)` — the tuple that
    actually identifies a fetch target; `limit_pages` and `name` come
    from whichever user's row is seen first for that tenant.

    A user whose profile can't be materialized (missing/malformed
    `profiles` row) is skipped with a warning rather than failing the
    whole discovery cycle — one broken profile must not block every
    other user's boards from being fetched.
    """
    greenhouse_boards: dict[str, str] = {}
    lever_boards: dict[str, str] = {}
    ashby_boards: dict[str, str] = {}
    workday_rows: dict[tuple, dict] = {}

    for user_id in user_ids:
        try:
            profile_dir = materialize_profile_dir(user_id)
        except Exception as exc:  # noqa: BLE001 — one bad profile must not abort the cycle
            logger.warning(
                "discovery: could not materialize profile for user_id=%s: %s",
                user_id, exc,
            )
            continue

        for slug, name in companies("greenhouse", profile_dir):
            greenhouse_boards.setdefault(slug, name)
        for slug, name in companies("lever", profile_dir):
            lever_boards.setdefault(slug, name)
        for slug, name in companies("ashby", profile_dir):
            ashby_boards.setdefault(slug, name)
        for row in workday_tenants(profile_dir):
            key = (row.get("tenant"), row.get("site"), row.get("dc") or "wd1")
            workday_rows.setdefault(key, row)

    return {
        "greenhouse": list(greenhouse_boards.items()),
        "lever": list(lever_boards.items()),
        "ashby": list(ashby_boards.items()),
        "workday": list(workday_rows.values()),
    }


def _union_profiles(user_ids: list[str]) -> list[dict]:
    """Materialize every user's profile and return the parsed
    `profile.yml` dicts — input to `sources.query_templates.union_queries`
    (P0.6). Separate from `_union_portal_targets` (different output
    shape); `materialize_profile_dir` is cheap to call again here — it
    only re-fetches from Supabase when the cached copy is stale, so this
    isn't a second round-trip per user in the common case.

    A user whose profile can't be materialized is skipped with a warning,
    same resilience contract as `_union_portal_targets`.
    """
    profiles: list[dict] = []
    for user_id in user_ids:
        try:
            profile_dir = materialize_profile_dir(user_id)
        except Exception as exc:  # noqa: BLE001 — one bad profile must not abort the cycle
            logger.warning(
                "discovery: could not materialize profile for user_id=%s "
                "(query templates): %s", user_id, exc,
            )
            continue
        profiles.append(load_profile(profile_dir))
    return profiles


def _dedup_fetch(module, job_iter, seen_ids: set[str]):
    """Drive one source's fetch iterator, dropping ids already in
    ``seen_ids`` (cross-source dedup) and logging+swallowing a per-source
    fetch error rather than aborting the whole cycle — matching
    `jobify.hunt.agent.iter_all_jobs`'s own per-source try/except."""
    try:
        for job in job_iter:
            if job["id"] in seen_ids:
                logger.debug(
                    "discovery: cross-source dedup hit on %s (id=%s)",
                    module.__name__, job["id"],
                )
                continue
            seen_ids.add(job["id"])
            yield job
    except Exception as exc:  # noqa: BLE001 — one source's bug must not abort the cycle
        logger.error("discovery: [%s] error: %s", module.__name__, exc)


def _iter_union_postings(union: dict[str, list], paid_queries: list[str], board_counters: dict[str, int]):
    """Yield job dicts from every portal-based source's union target list,
    the three fixed keyword-search sources, and jsearch/serpapi's
    per-user query union, cross-source deduped by canonical job id.

    Mirrors `jobify.hunt.agent.iter_all_jobs`'s cross-source dedup, now
    across the full nine-source set that single-user `jobify-hunt` runs:
    the four portals.yml-configured sources are called with the per-user
    union target list; the three fixed sources (`_FIXED_SOURCES`) take no
    arguments and are called exactly once; jsearch/serpapi (P0.6) are
    called once each with the same deduped `paid_queries` list — the cap
    was already applied per-provider by the caller.

    `board_counters` (P0.4, HUNT2 session 47): mutated in place —
    `boards_total` / `boards_fetched` / `boards_skipped_empty` across the
    four portal-type slots (greenhouse/lever/ashby/workday). A type with
    an empty union target list (no user has any board configured for it
    this cycle) used to be silently skipped; now it's WARN-logged and
    counted, so an empty-sections user shows up in the run summary
    instead of a discovery run that just quietly did less than expected.
    """
    seen_ids: set[str] = set()
    portal_fetchers = (
        (greenhouse, union["greenhouse"]),
        (lever, union["lever"]),
        (ashby, union["ashby"]),
        (workday, union["workday"]),
    )
    for module, targets in portal_fetchers:
        board_counters["boards_total"] += 1
        if not targets:
            board_counters["boards_skipped_empty"] += 1
            logger.warning(
                "discovery: %s has no boards configured by any user this "
                "cycle — skipping fetch (empty union)", module.__name__,
            )
            continue
        board_counters["boards_fetched"] += 1
        # apply_title_filter=False: discovery's job is landing every
        # posting into the SHARED pool, not filtering by whichever one
        # profile happens to be process-global-active. Per-user title
        # filtering happens downstream in Task 3's fan-out (Stage 1)
        # against the full pool, not here.
        yield from _dedup_fetch(
            module, module.fetch(targets, apply_title_filter=False), seen_ids,
        )

    for module in _FIXED_SOURCES:
        yield from _dedup_fetch(module, module.fetch(), seen_ids)

    if paid_queries:
        yield from _dedup_fetch(jsearch, jsearch.fetch(paid_queries), seen_ids)
        yield from _dedup_fetch(serpapi, serpapi.fetch(paid_queries), seen_ids)


def run_discovery_cycle() -> dict:
    """Run one global discovery cycle: union every user's `portals.yml`
    boards, fetch each real posting exactly once, resolve links, and
    upsert into the shared `postings` pool.

    Returns a summary dict (`users`, `boards`, `paid_queries`, `fetched`,
    `upserted`, `dead`, plus P0.4's `boards_total` / `boards_fetched` /
    `boards_skipped_empty`) for the caller's cycle-summary log line (Task
    4's entry point) — `jobify.hosted.worker` merges this whole dict into
    the `hunt_cycles.counters` jsonb alongside the fan-out summary, the
    same place `first_error` already lands, so an empty-sections user is
    never a silent no-op again. Zero LLM tokens; every DB write goes
    through `jobify.db.upsert_posting` (service-role).
    """
    user_ids = db.list_profile_user_ids()
    union = _union_portal_targets(user_ids)
    paid_queries = union_queries(
        _union_profiles(user_ids), cap=_PAID_QUERY_CAP, provider="jsearch/serpapi",
    )
    board_counters = {"boards_total": 0, "boards_fetched": 0, "boards_skipped_empty": 0}

    fetched = 0
    upserted = 0
    dead = 0

    for job in _iter_union_postings(union, paid_queries, board_counters):
        fetched += 1

        try:
            decision, _fetched_html = _resolve_link_and_liveness(job)
        except Exception as exc:  # noqa: BLE001 — never let a resolver bug drop a posting
            logger.error("discovery: [resolve] error on %s: %s", job.get("url"), exc)
            decision = "ok"
            job.setdefault("link_status", "aggregator_unverified")

        if decision == "dead":
            dead += 1

        try:
            db.upsert_posting(job)
            upserted += 1
        except Exception as exc:  # noqa: BLE001 — one write failure must not abort the cycle
            logger.error("discovery: [db] upsert error for %s: %s", job.get("id"), exc)

    summary = {
        "users": len(user_ids),
        "boards": {k: len(v) for k, v in union.items()},
        "paid_queries": len(paid_queries),
        "fetched": fetched,
        "upserted": upserted,
        "dead": dead,
        **board_counters,
    }
    logger.info("discovery cycle done: %s", summary)
    return summary
