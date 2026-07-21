"""sources/greenhouse.py — Greenhouse boards-api source (J-1).

Direct Greenhouse public-API scanner:
    https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true

Pure HTTP/JSON. No LLM tokens spent on discovery. Each posting is
title-pre-filtered against `profile/portals.yml::title_filter` before
the LLM scorer ever sees it.

Company list lives in `profile/portals.yml::greenhouse.companies`. The
in-module `_FALLBACK_COMPANIES` is consulted only if portals.yml is
missing — keeps the hunter running during cutover.

Discovery is location-agnostic (P0.1, HUNT2 session 47 — owner directive):
this source used to skip roles whose location wasn't a hardcoded metro or
remote-shaped. Location preference is now enforced entirely per-user at
scoring/ranking time (P0.7); every role this board publishes lands in the
pool.
"""

import logging

from jobify.shared.html import strip_tags
from jobify.shared.jobid import make_job_id
from sources._http import fetch_json, passes_title_filter, sleep_between_requests
from sources._portals import companies, title_signals
from sources.remote_infer import infer_remote

logger = logging.getLogger("sources.greenhouse")


# Last-resort fallback for when portals.yml is missing. Keep this list
# tiny — the canonical list lives in portals.yml.
_FALLBACK_COMPANIES = [
    ("anthropic", "Anthropic"),
    ("neuralink", "Neuralink"),
]


def _first_department_name(job: dict) -> str | None:
    """Greenhouse's `departments` is a list of `{id, name, ...}`; take the
    first — good enough for the metadata-retention column (HUNT2 S3), not
    a full org-chart mapping."""
    departments = job.get("departments") or []
    if departments and isinstance(departments[0], dict):
        return departments[0].get("name") or None
    return None


def _metadata_value(job: dict, field_name_lower: str) -> str | None:
    """Greenhouse's `metadata` is a list of custom board fields
    (`{name, value, ...}`); Greenhouse has no standard `employment_type`
    field, but some boards add one as a custom field (e.g. "Employment
    Type") — match case-insensitively, return None (never guess) if the
    board doesn't define one."""
    for entry in job.get("metadata") or []:
        if str(entry.get("name") or "").strip().lower() == field_name_lower:
            value = entry.get("value")
            return str(value) if value is not None else None
    return None


def _fetch_one(slug: str, display_name: str, apply_title_filter: bool = True):
    """Fetch open roles from a single Greenhouse board.

    ``apply_title_filter=False`` skips the process-global-profile title
    gate entirely — used by the H4 hosted discovery worker
    (``jobify.hosted.discovery``), which fetches into the SHARED postings
    pool and must not let one arbitrary profile's title/seniority
    preferences drop a posting before any other hosted user ever sees it.
    Per-user title filtering happens downstream, in Task 3's fan-out.
    """
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
    data = fetch_json(url, log=logger, label=slug)
    if data is None:
        return

    raw_count = 0
    yielded = 0
    skipped_title = 0
    for job in data.get("jobs", []):
        raw_count += 1
        title = job.get("title", "")
        location = job.get("location", {}).get("name", "Unknown")
        description = strip_tags(job.get("content", ""))
        link = job.get("absolute_url", "")

        # Cheap title-only filter before we look at description or score.
        if apply_title_filter and not passes_title_filter(title):
            skipped_title += 1
            continue

        signals = title_signals(title)
        if signals["prefer"] or signals["seniority"]:
            logger.debug("greenhouse: %s title signals %s on %r", slug, signals, title)

        yielded += 1
        yield {
            "id": make_job_id(link, title, display_name),
            "source": "greenhouse",
            "query": "",
            "title": title,
            "company": display_name,
            "location": location,
            "remote": infer_remote(location, job),
            "description": description[:3000],
            "url": link,
            "posted_at": job.get("first_published") or job.get("updated_at"),
            "department": _first_department_name(job),
            "employment_type": _metadata_value(job, "employment type"),
            "raw": job,
        }
    logger.info(
        "greenhouse: %s yielded=%d (raw=%d, title-filtered=%d)",
        slug, yielded, raw_count, skipped_title,
    )


def fetch(targets: list[tuple[str, str]] | None = None, apply_title_filter: bool = True):
    """Yield job dicts from every Greenhouse board listed in portals.yml.

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
    boards = targets if targets is not None else (companies("greenhouse") or _FALLBACK_COMPANIES)
    for slug, name in boards:
        yield from _fetch_one(slug, name, apply_title_filter=apply_title_filter)
        sleep_between_requests()
