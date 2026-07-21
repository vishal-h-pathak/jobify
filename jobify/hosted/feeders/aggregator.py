"""jobify.hosted.feeders.aggregator — aggregator-unknown-company routing
feeder (HUNT2 P2 S4, planning/HUNT2_SOURCES.md §4.2 #2).

A post-pass over the state fan-out and discovery already wrote — reads
`matches` and `postings`, never hooks into `jobify.hosted.fanout` inline
(collision rule: fanout.py is session 50's). When a non-portal-source
posting survived at least the stage-1 title filter (`matches.status !=
'rejected_title'`) and its company isn't already in `board_catalog`,
that's the system's highest-precision discovery signal — "a real user's
filter liked a job at a company we don't track" — so it's enqueued as a
candidate.

Non-portal source = anything that isn't one of the four `portals.yml`-
configured ATS fetchers (greenhouse/lever/ashby/workday) — those are
already tracked directly, by definition, since they only ever fetch
boards a user (or the catalog) already lists. Computed as a set
difference rather than hardcoding the aggregator source names from the
spec doc (`remoteok/wwr/remotive/serpapi/jsearch`, some of which this
repo's `jobify/hunt/sources/` doesn't actually have) so it stays correct
if discovery's non-portal source list changes.

Statelessness note (SUPERSEDED, P3 S6): this used to full-table-scan the
current `matches` table every cycle — `jobify.hosted.candidates`' own
dedup (against `candidate_boards` ANY status, then `board_catalog`)
already makes a re-scan of an already-processed company a cheap,
idempotent no-op, so correctness never depended on a cursor. But the
read itself got expensive as `matches` grew (same category of scale
caveat `jobify.db.get_unmatched_postings` already documents for itself),
so this now reads only rows created since the last cycle's cursor
(`feeder_cursors` table, 0018) and advances it to the max `created_at`
seen — `jobify.db.list_non_title_rejected_matches`'s own docstring notes
why `created_at` is a safe, stable cursor field despite matches being
re-scored (upserted) many times after insert. A feeder that has never
run before has no cursor yet and reads everything, same as before this
change.
"""

from __future__ import annotations

from jobify import db
from jobify.hosted.candidates import normalize_company_name
from jobify.hosted.feeders._ats_url import parse_ats_slug

_PORTAL_SOURCES = frozenset({"greenhouse", "lever", "ashby", "workday"})
_CURSOR_NAME = "aggregator"


def route_candidates() -> list[dict]:
    """Every distinct company behind a title-filter-surviving,
    non-portal-source posting whose company isn't already catalogued, as
    `jobify.hosted.candidates.enqueue`-shaped items.
    """
    cursor = db.get_feeder_cursor(_CURSOR_NAME)
    matches = db.list_non_title_rejected_matches(since=cursor)
    if not matches:
        return []

    # Computed now but only PERSISTED at the very end, after `out` is
    # fully built — if anything below raises partway, the cursor must
    # NOT have moved yet, or these matches would be silently skipped on
    # every future scan instead of safely (if redundantly) reconsidered.
    newest_created_at = max((m.get("created_at") for m in matches if m.get("created_at")), default=None)

    posting_ids = list({m["posting_id"] for m in matches if m.get("posting_id")})
    if not posting_ids:
        return []
    postings = db.get_postings_by_ids(posting_ids)

    catalog_rows = db.list_board_catalog_rows()
    known_names = {normalize_company_name(r.get("company_name") or "") for r in catalog_rows}
    known_ats_slugs = {(r.get("ats"), r.get("slug")) for r in catalog_rows}

    out: list[dict] = []
    seen: set[str] = set()
    for posting in postings:
        source = posting.get("source")
        if not source or source in _PORTAL_SOURCES:
            continue
        company = (posting.get("company") or "").strip()
        if not company:
            continue
        normalized = normalize_company_name(company)
        if not normalized or normalized in known_names or normalized in seen:
            continue

        ats, slug = parse_ats_slug(posting.get("application_url") or "")
        if ats and slug and (ats, slug) in known_ats_slugs:
            continue

        seen.add(normalized)
        item = {
            "company_name": company,
            "evidence_kind": "aggregator_match",
            "evidence_url": posting.get("application_url"),
        }
        if ats and slug:
            item["proposed_ats"] = ats
            item["proposed_slug"] = slug
        out.append(item)

    if newest_created_at:
        db.set_feeder_cursor(_CURSOR_NAME, newest_created_at)
    return out
