"""
sources/serpapi.py — Google Jobs results via SerpAPI.

Cost discipline matters here: SerpAPI's free tier is 100 searches/month.
Three guards enforce a per-run budget:

1. ``MAX_SEARCHES_PER_RUN`` hard cap. We stop iterating once we hit it and
   log a clear "budget exhausted" message rather than silently truncating.
2. Pagination short-circuits once a page yields nothing new (almost every
   page after the first is duplicates anyway).
3. Per-run logging of total searches issued so the budget shows up in
   ``agent.log``.

Queries are per-user template expansion (P0.6, HUNT2 session 47), not a
hardcoded list: the hosted discovery worker (``jobify.hosted.discovery``)
passes the deduped, capped union of every user's queries via ``queries=``;
the single-user CLI path (``fetch()`` called with no argument) derives
queries from whichever ONE profile is currently active
(``sources.query_templates.queries_for_active_profile``). Discovery is
location-agnostic (P0.1) — a query's location intent (if any: "remote",
a metro name) is baked into the query string itself by the template, so
there is no separate location matrix or mode branch here anymore; the
SerpAPI ``location`` param is always the broad "United States" default.
"""

from __future__ import annotations

import logging
import os
import time

import requests

from jobify.shared.jobid import make_job_id
from sources.query_templates import queries_for_active_profile
from sources.remote_infer import infer_remote

logger = logging.getLogger("sources.serpapi")

ENDPOINT = "https://serpapi.com/search.json"

# Hard cap so a single run can't burn the whole monthly free tier. Default
# dropped 30 → 15 → 8 as more free sources came online (Ashby, HN, 80kh,
# JSearch). At 8/run × ~30 days that's 240/month — well inside the SerpAPI
# free tier (100/month) when you also factor in days you don't run. Override
# via the env var if you want a wider sweep.
MAX_SEARCHES_PER_RUN = int(os.environ.get("SERPAPI_MAX_SEARCHES", "8"))

# Cap pages per query. Most relevant results appear on page 1.
MAX_PAGES = 2

# Broad, provider-side default — real location targeting now lives in the
# query string itself (P0.6's template appends "remote" or a metro name).
_LOCATION = "United States"


def fetch(queries: list[str] | None = None):
    """Yield job dicts from SerpAPI's Google Jobs endpoint with pagination.

    ``queries`` defaults to the active single-user profile's template
    queries (CLI path); the hosted discovery worker always passes an
    explicit, pre-deduped, pre-capped list.
    """
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        logger.warning("SERPAPI_KEY not set — skipping serpapi source")
        return

    if queries is None:
        queries = queries_for_active_profile()
    if not queries:
        logger.info("serpapi: no queries to run — skipping")
        return

    seen_local: set[str] = set()
    searches_issued = 0
    yielded = 0

    budget_exhausted = False
    for query in queries:
        if budget_exhausted:
            break
        for page in range(MAX_PAGES):
            if searches_issued >= MAX_SEARCHES_PER_RUN:
                logger.warning(
                    "serpapi: budget exhausted at %d searches "
                    "(MAX_SEARCHES_PER_RUN=%d) — stopping",
                    searches_issued, MAX_SEARCHES_PER_RUN,
                )
                budget_exhausted = True
                break

            params = {
                "engine": "google_jobs",
                "q": query,
                "location": _LOCATION,
                "api_key": api_key,
                "start": page * 10,
            }
            try:
                resp = requests.get(ENDPOINT, params=params, timeout=30)
                searches_issued += 1
                resp.raise_for_status()
                data = resp.json()
            except Exception as exc:
                logger.warning(
                    "serpapi: request failed q=%r page=%d: %s",
                    query, page, exc,
                )
                time.sleep(1)
                break  # stop paginating on error

            results = data.get("jobs_results", []) or []
            if not results:
                logger.info("serpapi: 0 results q=%r page=%d (stop)", query, page)
                break  # no more pages

            page_yield = 0
            for job in results:
                title = job.get("title", "")
                company = job.get("company_name", "Unknown")
                location = job.get("location", "")
                description = job.get("description", "")
                link = ""
                for opt in job.get("apply_options", []) or []:
                    if opt.get("link"):
                        link = opt["link"]
                        break
                if not link:
                    link = job.get("share_link") or job.get("job_id", "")
                jid = make_job_id(link, title, company)
                if jid in seen_local:
                    continue
                seen_local.add(jid)
                page_yield += 1
                yielded += 1
                yield {
                    "id": jid,
                    "source": "serpapi",
                    "query": query,
                    "title": title,
                    "company": company,
                    "location": location,
                    "remote": infer_remote(location, job),
                    "description": description,
                    "url": link,
                    # HUNT2 S5: provenance — which paid-search query
                    # surfaced this posting (S6's rollups read
                    # `_jobify_query` back out of `postings.raw`).
                    # SerpAPI didn't emit a `raw` field before this; the
                    # full `job` payload isn't captured here, only the
                    # query — a separate task if SerpAPI's raw response
                    # is ever needed downstream too.
                    "raw": {"_jobify_query": query},
                }
            logger.info(
                "serpapi: page yielded %d new q=%r page=%d",
                page_yield, query, page,
            )
            # Short-circuit if a page produced nothing new — pagination
            # past that point is almost certainly more dupes.
            if page_yield == 0:
                break
            time.sleep(1)

    logger.info(
        "serpapi total: %d unique entries from %d searches (budget=%d)",
        yielded, searches_issued, MAX_SEARCHES_PER_RUN,
    )
