"""sources/ashby.py — AshbyHQ public posting API (J-1).

Direct Ashby public-API scanner:
    https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true

Pure HTTP/JSON. No LLM tokens spent on discovery. Each posting is
title-pre-filtered against `profile/portals.yml::title_filter` before
the LLM scorer ever sees it.

Company list lives in `profile/portals.yml::ashby.companies`. The
in-module `_FALLBACK_COMPANIES` is consulted only if portals.yml is
missing.

Discovery is location-agnostic (P0.1, HUNT2 session 47 — owner directive):
location preference is enforced entirely per-user at scoring/ranking time
(P0.7); every role this board publishes lands in the pool.
"""

from __future__ import annotations

import logging

from jobify.shared.html import strip_tags
from jobify.shared.jobid import make_job_id
from sources._http import fetch_json, passes_title_filter, sleep_between_requests
from sources._portals import companies, title_signals
from sources.remote_infer import infer_remote

logger = logging.getLogger("sources.ashby")


_FALLBACK_COMPANIES: list[tuple[str, str]] = []


def _fetch_one(slug: str, display_name: str, apply_title_filter: bool = True):
    """Fetch open roles from one Ashby board.

    ``apply_title_filter=False`` skips the process-global-profile title
    gate entirely — used by the H4 hosted discovery worker
    (``jobify.hosted.discovery``), which fetches into the SHARED postings
    pool and must not let one arbitrary profile's title/seniority
    preferences drop a posting before any other hosted user ever sees it.
    Per-user title filtering happens downstream, in Task 3's fan-out.
    """
    url = f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"
    data = fetch_json(url, log=logger, label=slug)
    if data is None:
        return

    raw = 0
    yielded = 0
    skipped_title = 0
    for job in data.get("jobs", []):
        if not job.get("isListed", True):
            continue
        raw += 1
        title = job.get("title") or ""
        location = job.get("location") or "Unknown"
        description = strip_tags(job.get("descriptionHtml") or job.get("descriptionPlain") or "")
        link = job.get("jobUrl") or job.get("applyUrl") or ""

        if apply_title_filter and not passes_title_filter(title):
            skipped_title += 1
            continue

        signals = title_signals(title)
        if signals["prefer"] or signals["seniority"]:
            logger.debug("ashby: %s title signals %s on %r", slug, signals, title)

        yielded += 1
        yield {
            "id": make_job_id(link, title, display_name),
            "source": "ashby",
            "query": "",
            "title": title,
            "company": display_name,
            "location": location,
            "remote": infer_remote(location, job),
            "description": description[:3000],
            "url": link,
        }
    logger.info(
        "ashby: %s yielded=%d (raw=%d, title-filtered=%d)",
        slug, yielded, raw, skipped_title,
    )


def fetch(targets: list[tuple[str, str]] | None = None, apply_title_filter: bool = True):
    """Yield job dicts from every tracked Ashby board.

    ``targets`` optionally overrides the portals.yml-derived company list
    with an explicit ``[(slug, name), ...]`` list — the H4 hosted discovery
    worker (``jobify.hosted.discovery``) passes the UNION of every user's
    boards here so one process fetch serves everyone, instead of
    re-deriving the single active profile's list. Omit it (every existing
    ``jobify-hunt`` call site) and behavior is byte-identical to before.

    ``apply_title_filter`` defaults to True (current behavior — the
    process-global-profile title gate applies) so every existing
    single-user call site is byte-identical. The hosted discovery worker
    passes ``apply_title_filter=False`` since discovery's job is landing
    postings in the shared pool, not filtering by one profile's title
    preferences.
    """
    boards = targets if targets is not None else (companies("ashby") or _FALLBACK_COMPANIES)
    for slug, name in boards:
        yield from _fetch_one(slug, name, apply_title_filter=apply_title_filter)
        sleep_between_requests()
