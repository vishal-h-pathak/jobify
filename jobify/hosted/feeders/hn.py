"""jobify.hosted.feeders.hn — HN "Who is hiring?" company extraction
feeder (HUNT2 P2 S4, planning/HUNT2_SOURCES.md §4.2 #1).

Reuses postings the discovery cycle's `hn_whoshiring` source ALREADY
fetched this cycle (`jobify.hosted.discovery` writes every source's
output into the shared `postings` pool) — this module makes zero HTTP
calls of its own and never re-hits HN's Algolia API. Extracts a candidate
company from every `source='hn_whoshiring'` posting whose apply link
parses straight to a Greenhouse/Lever/Ashby slug (`_ats_url.parse_ats_slug`)
— the highest-confidence signal HN parsing can yield, per
`sources.hn_whoshiring.fetch`'s own docstring on how loosely-structured
the raw comment format is — and hands it to
`jobify.hosted.candidates.run_candidates_cycle` with the HN posting's own
apply URL as evidence.

A posting whose apply link ISN'T a direct ATS URL (an email address, a
generic company careers page) is simply not this feeder's candidate —
`jobify.hosted.feeders.aggregator`'s broader, lower-confidence post-pass
covers every non-portal source's company names, HN included.
"""

from __future__ import annotations

from jobify import db
from jobify.hosted.feeders._ats_url import parse_ats_slug

_FEEDER_ATS = ("greenhouse", "lever", "ashby")


def extract_candidates() -> list[dict]:
    """Every HN-sourced posting whose apply link is a direct ATS URL, as
    `jobify.hosted.candidates.enqueue`-shaped items. Deduped by
    `(ats, slug)` within this call — the same board posted twice in one
    thread (or re-seen across cycles, since `postings` retains history)
    only needs to be proposed once here.
    """
    postings = db.list_postings_by_source("hn_whoshiring")
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for posting in postings:
        url = posting.get("application_url") or ""
        ats, slug = parse_ats_slug(url)
        if not ats or not slug or ats not in _FEEDER_ATS:
            continue
        key = (ats, slug)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "company_name": (posting.get("company") or slug).strip(),
            "evidence_kind": "hn_thread",
            "evidence_url": url,
            "proposed_ats": ats,
            "proposed_slug": slug,
        })
    return out
