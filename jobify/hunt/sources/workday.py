"""sources/workday.py — Workday public job-search API (J-1).

Workday tenants expose a public job-search endpoint at:

    https://<tenant>.wd<dc>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs

It accepts a JSON POST with `appliedFacets`, `limit`, and `offset`. We
walk pages until we run out of results or hit a configured cap. No LLM
tokens spent on discovery; each posting passes through the title pre-
filter before reaching the scorer.

Tenant config lives in `profile/portals.yml::workday.companies`. Each
row needs at minimum `tenant`, `site`, `dc`, and `name`. Per-row
`limit_pages` caps how many pages we walk for that tenant (default 2 —
50 jobs each, so 100 jobs/tenant).

Workday details are tenant-specific. If a row 404s or 500s, we log a
warning and continue. Add new rows incrementally; verify the careers
URL in a browser first.

Discovery is location-agnostic (P0.1, HUNT2 session 47 — owner directive):
location preference is enforced entirely per-user at scoring/ranking time
(P0.7); every role a tenant publishes lands in the pool.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Iterable

from jobify.shared.html import strip_tags
from jobify.shared.jobid import make_job_id
from sources._http import fetch_json, passes_title_filter, sleep_between_requests
from sources._portals import title_signals, workday_tenants
from sources.remote_infer import infer_remote

logger = logging.getLogger("sources.workday")


def _posted_at_iso(start_date: str | None) -> str | None:
    """`jobPostingInfo.startDate` is a plain `YYYY-MM-DD` date string;
    postings.posted_at is TIMESTAMPTZ, so anchor it at midnight UTC.
    Missing/malformed input returns None, never a guessed value."""
    if not start_date:
        return None
    try:
        date.fromisoformat(start_date)
    except ValueError:
        return None
    return f"{start_date}T00:00:00+00:00"

USER_AGENT = "job-hunter/1.0"
_HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}

# Default pagination; per-tenant rows can override via `limit_pages`.
PAGE_SIZE = 20
DEFAULT_LIMIT_PAGES = 2


def _post_search(tenant: str, site: str, dc: str, offset: int) -> dict:
    """Hit the Workday job-search endpoint for one page."""
    url = (
        f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
    )
    body = {"appliedFacets": {}, "limit": PAGE_SIZE, "offset": offset, "searchText": ""}
    data = fetch_json(
        url,
        method="POST",
        json_body=body,
        headers=_HEADERS,
        timeout=20,
        log=logger,
        label=f"{tenant}/{site}",
    )
    return data or {}


def _fetch_job_detail(tenant: str, site: str, dc: str, external_path: str) -> dict:
    """Fetch full description for a single Workday job posting."""
    url = (
        f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{external_path}"
    )
    data = fetch_json(url, headers=_HEADERS, timeout=20, log=logger, label=external_path)
    return data or {}


def _fetch_one(row: dict, apply_title_filter: bool = True) -> Iterable[dict]:
    """Yield jobs for one Workday tenant config row.

    ``apply_title_filter=False`` skips the process-global-profile title
    gate entirely — used by the H4 hosted discovery worker
    (``jobify.hosted.discovery``), which fetches into the SHARED postings
    pool and must not let one arbitrary profile's title/seniority
    preferences drop a posting before any other hosted user ever sees it.
    Per-user title filtering happens downstream, in Task 3's fan-out.
    """
    tenant = (row.get("tenant") or "").strip()
    site = (row.get("site") or "").strip()
    dc = (row.get("dc") or "wd1").strip()
    name = (row.get("name") or tenant).strip()
    limit_pages = int(row.get("limit_pages") or DEFAULT_LIMIT_PAGES)

    if not tenant or not site:
        logger.warning("workday: skipping malformed row %r", row)
        return

    raw = 0
    yielded = 0
    skipped_title = 0

    for page in range(limit_pages):
        offset = page * PAGE_SIZE
        try:
            data = _post_search(tenant, site, dc, offset)
        except Exception as exc:
            logger.warning(
                "workday: page %d fetch failed for %s/%s (%s): %s",
                page, tenant, site, dc, exc,
            )
            break

        postings = data.get("jobPostings") or []
        if not postings:
            break

        for p in postings:
            raw += 1
            title = p.get("title") or ""
            location = p.get("locationsText") or "Unknown"
            external_path = p.get("externalPath") or ""

            if apply_title_filter and not passes_title_filter(title):
                skipped_title += 1
                continue

            # Detail call — only for postings that survived the cheap filters.
            description = ""
            jp: dict = {}
            if external_path:
                detail = _fetch_job_detail(tenant, site, dc, external_path)
                jp = (detail.get("jobPostingInfo") or {})
                description = strip_tags(jp.get("jobDescription") or "")

            link = (
                f"https://{tenant}.{dc}.myworkdayjobs.com/{site}{external_path}"
                if external_path
                else f"https://{tenant}.{dc}.myworkdayjobs.com/{site}"
            )

            signals = title_signals(title)
            if signals["prefer"] or signals["seniority"]:
                logger.debug("workday: %s/%s title signals %s on %r", tenant, site, signals, title)

            yielded += 1
            yield {
                "id": make_job_id(link, title, name),
                "source": "workday",
                "query": "",
                "title": title,
                "company": name,
                "location": location,
                "remote": infer_remote(location, p),
                "description": description[:3000],
                "url": link,
                # `startDate` on the detail payload is the exact posted-on
                # date, not a future job-start date — confirmed live
                # (target.wd5/homedepot.wd5): it matches the human-readable
                # `postedOn` string exactly (e.g. "Posted Yesterday" ==
                # startDate == today-1). `timeType` ("Full time"/"Part
                # time"/"Variable") is Workday's employment-type field; no
                # department or structured comp field is exposed by either
                # verified tenant, so both stay None (never guessed).
                "posted_at": _posted_at_iso(jp.get("startDate")),
                "employment_type": jp.get("timeType") or None,
                "raw": {"list": p, "detail": jp},
            }

        sleep_between_requests()

    logger.info(
        "workday: %s/%s yielded=%d (raw=%d, title-filtered=%d)",
        tenant, site, yielded, raw, skipped_title,
    )


def fetch(tenants: list[dict] | None = None, apply_title_filter: bool = True):
    """Yield job dicts from every Workday tenant in portals.yml.

    ``tenants`` optionally overrides the portals.yml-derived tenant-row
    list — the H4 hosted discovery worker (``jobify.hosted.discovery``)
    passes the UNION of every user's tenants here so one process fetch
    serves everyone, instead of re-deriving the single active profile's
    list. Omit it (every existing ``jobify-hunt`` call site) and behavior
    is byte-identical to before.

    ``apply_title_filter`` defaults to True (current behavior — the
    process-global-profile title gate applies) so every existing
    single-user call site is byte-identical. The hosted discovery worker
    passes ``apply_title_filter=False`` since discovery's job is landing
    postings in the shared pool, not filtering by one profile's title
    preferences.
    """
    rows = tenants if tenants is not None else workday_tenants()
    for row in rows:
        yield from _fetch_one(row, apply_title_filter=apply_title_filter)
        sleep_between_requests()
