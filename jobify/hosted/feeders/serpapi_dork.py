"""jobify.hosted.feeders.serpapi_dork — SerpAPI ATS-site dork feeder
(HUNT2 P2 S4, planning/HUNT2_SOURCES.md §4.2 #3).

Collision rule: `sources.serpapi` (the existing paid job-search fetcher)
is session 50's — this module never imports its `fetch()` or edits it.
Instead it makes its OWN SerpAPI calls, via `sources._http.fetch_json`
(shared, read-only helper), using Google's organic-search engine
(`engine=google` — NOT `engine=google_jobs`, which is Google's structured
Jobs API and doesn't honor `site:` dork operators against indexed pages)
for queries like `site:boards.greenhouse.io "<title keyword>"`. Slugs
parse directly out of each organic result's URL
(`jobify.hosted.feeders._ats_url.parse_ats_slug`).

Title keywords are the union of every active user's own
`portals.yml::title_filter.prefer_substrings` (read ONLY, via
`jobify.profile_loader` — this module never edits a user's portals
config, and never touches `sources._portals` either, since that lives in
the same collision-sensitive fetcher family).

Budget: capped at ~20% of `sources.serpapi.MAX_SEARCHES_PER_RUN` (a
read-only import of that constant, so the two budgets move together as
one knob) — the paid job-search fetcher keeps the lion's share of the
monthly SerpAPI allowance; this discovery-only feeder gets a small,
bounded slice. Skips cleanly (zero calls, zero cost) when `SERPAPI_KEY`
isn't set or no active user has any `prefer_substrings` configured.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlencode

# Triggers jobify.hunt.agent's sys.path bootstrap (inserts jobify/hunt/ so
# the bare `sources.*` imports below resolve) — must run before them. Same
# defensive pattern `jobify.hosted.fanout` uses for its own bare `sources`
# import, so this module is independently importable (tests, standalone
# calls) without relying on some other module having imported it first.
import jobify.hunt.agent  # noqa: F401

from sources._http import fetch_json  # noqa: E402
from sources.serpapi import MAX_SEARCHES_PER_RUN as _SERPAPI_BASE_BUDGET  # noqa: E402

from jobify import db
from jobify.hosted.feeders._ats_url import parse_ats_slug
from jobify.profile_loader import load_portals, materialize_profile_dir

logger = logging.getLogger("jobify.hosted.feeders.serpapi_dork")

ENDPOINT = "https://serpapi.com/search.json"

# "~20% of the SerpAPI call budget per cycle" (spec) — round, at least 1
# so the feeder isn't accidentally disabled by rounding down to zero.
DORK_MAX_SEARCHES = max(1, round(_SERPAPI_BASE_BUDGET * 0.2))

# Bounds total possible (site, keyword) combinations generated below —
# the search-budget cap above is what actually limits real HTTP calls;
# this just keeps the candidate query LIST itself from growing unbounded
# as more users configure more prefer_substrings.
MAX_KEYWORDS = 5

_DORK_SITES: dict[str, str] = {
    "greenhouse": "boards.greenhouse.io",
    "lever": "jobs.lever.co",
    "ashby": "jobs.ashbyhq.com",
}


def _union_prefer_substrings() -> list[str]:
    """Union of every active user's `title_filter.prefer_substrings`,
    deduped case-insensitively, first-seen order, capped at
    `MAX_KEYWORDS`. A user whose profile can't be materialized is
    skipped with a warning — one broken profile must not block the rest.
    """
    keywords: list[str] = []
    seen: set[str] = set()
    for user_id in db.list_profile_user_ids():
        try:
            profile_dir = materialize_profile_dir(user_id)
            portals = load_portals(profile_dir)
        except Exception as exc:  # noqa: BLE001 — one bad profile must not abort the union
            logger.warning(
                "serpapi_dork: could not read portals for user_id=%s: %s", user_id, exc,
            )
            continue
        prefer = (portals.get("title_filter") or {}).get("prefer_substrings") or []
        for kw in prefer:
            key = (kw or "").strip().lower()
            if key and key not in seen:
                seen.add(key)
                keywords.append(kw.strip())
    return keywords[:MAX_KEYWORDS]


def dork_candidates() -> list[dict]:
    """Run a budget-capped slice of ATS-site dorks and return every
    distinct board slug the results reveal, as
    `jobify.hosted.candidates.enqueue`-shaped items.
    """
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        logger.info("serpapi_dork: SERPAPI_KEY not set — skipping")
        return []

    keywords = _union_prefer_substrings()
    if not keywords:
        logger.info("serpapi_dork: no active user has prefer_substrings configured — skipping")
        return []

    out: list[dict] = []
    seen_slugs: set[tuple[str, str]] = set()
    searches_issued = 0
    budget_exhausted = False

    for ats, host in _DORK_SITES.items():
        if budget_exhausted:
            break
        for keyword in keywords:
            if searches_issued >= DORK_MAX_SEARCHES:
                logger.info(
                    "serpapi_dork: budget exhausted at %d searches (cap=%d) — stopping",
                    searches_issued, DORK_MAX_SEARCHES,
                )
                budget_exhausted = True
                break

            query = f'site:{host} "{keyword}"'
            params = urlencode({"engine": "google", "q": query, "api_key": api_key, "num": 10})
            data = fetch_json(f"{ENDPOINT}?{params}", log=logger, label=query)
            searches_issued += 1
            if not data:
                continue

            for result in data.get("organic_results") or []:
                link = result.get("link") or ""
                probed_ats, slug = parse_ats_slug(link)
                if not probed_ats or not slug or probed_ats != ats:
                    continue
                key = (probed_ats, slug)
                if key in seen_slugs:
                    continue
                seen_slugs.add(key)
                out.append({
                    # Best-effort guess only — the Google result's own page
                    # title, often noisy ("Acme Corp - Senior Engineer -
                    # Greenhouse"). `slug_probe.probe_known_slug` re-verifies
                    # against the ATS's own metadata name on enqueue, so a
                    # noisy guess here degrades to a lower-confidence
                    # `pending` review row rather than a bad auto-admit.
                    "company_name": (result.get("title") or slug).strip(),
                    "evidence_kind": "serpapi_dork",
                    "evidence_url": link,
                    "proposed_ats": probed_ats,
                    "proposed_slug": slug,
                })

    logger.info(
        "serpapi_dork: %d searches issued, %d candidates found", searches_issued, len(out),
    )
    return out
