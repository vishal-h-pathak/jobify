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
       byte-compatible with the single-user `jobify-hunt` call).
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

Deliberately scoped to the portals.yml-configured ATS sources
(greenhouse/lever/ashby/workday) — the only sources with a per-user board
list to union. The other `jobify.hunt.sources` fetchers (remoteok,
serpapi, jsearch, hn_whoshiring, eighty_thousand_hours) run fixed
keyword searches with no per-user configuration to union, and are out of
this task's scope.
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
from jobify.profile_loader import materialize_profile_dir
from sources import ashby, greenhouse, lever, workday
from sources._portals import companies, workday_tenants

logger = logging.getLogger("jobify.hosted.discovery")


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


def _iter_union_postings(union: dict[str, list]):
    """Yield job dicts from every portal-based source's union target list,
    cross-source deduped by canonical job id.

    Mirrors `jobify.hunt.agent.iter_all_jobs`'s cross-source dedup, scoped
    to the four portals.yml-configured sources. A per-source fetch error
    is logged and skipped rather than aborting the whole cycle — matching
    `iter_all_jobs`'s own per-source try/except.
    """
    seen_ids: set[str] = set()
    fetchers = (
        (greenhouse, union["greenhouse"]),
        (lever, union["lever"]),
        (ashby, union["ashby"]),
        (workday, union["workday"]),
    )
    for module, targets in fetchers:
        if not targets:
            continue
        try:
            for job in module.fetch(targets):
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


def run_discovery_cycle() -> dict:
    """Run one global discovery cycle: union every user's `portals.yml`
    boards, fetch each real posting exactly once, resolve links, and
    upsert into the shared `postings` pool.

    Returns a summary dict (`users`, `boards`, `fetched`, `upserted`,
    `dead`) for the caller's cycle-summary log line (Task 4's entry
    point). Zero LLM tokens; every DB write goes through
    `jobify.db.upsert_posting` (service-role).
    """
    user_ids = db.list_profile_user_ids()
    union = _union_portal_targets(user_ids)

    fetched = 0
    upserted = 0
    dead = 0

    for job in _iter_union_postings(union):
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
        "fetched": fetched,
        "upserted": upserted,
        "dead": dead,
    }
    logger.info("discovery cycle done: %s", summary)
    return summary
