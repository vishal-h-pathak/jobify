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

Statelessness note (judgment call): "the latest cycle's matches" is
interpreted as "the current `matches` table", not a cycle-scoped window —
`jobify.hosted.candidates`' own dedup (against `candidate_boards` ANY
status, then `board_catalog`) already makes a re-scan of an
already-processed company a cheap, idempotent no-op, so no separate
cycle-boundary cursor/state is needed. Revisit if `matches`' row count
makes the full-table read expensive (same category of scale caveat
`jobify.db.get_unmatched_postings` already documents for itself).
"""

from __future__ import annotations

from jobify import db
from jobify.hosted.candidates import normalize_company_name
from jobify.hosted.feeders._ats_url import parse_ats_slug

_PORTAL_SOURCES = frozenset({"greenhouse", "lever", "ashby", "workday"})


def route_candidates() -> list[dict]:
    """Every distinct company behind a title-filter-surviving,
    non-portal-source posting whose company isn't already catalogued, as
    `jobify.hosted.candidates.enqueue`-shaped items.
    """
    matches = db.list_non_title_rejected_matches()
    if not matches:
        return []
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
    return out
