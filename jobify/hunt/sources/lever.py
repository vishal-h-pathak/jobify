"""sources/lever.py — Lever postings-API source (J-1).

Direct Lever public-API scanner:
    https://api.lever.co/v0/postings/{slug}?mode=json

Split out of `greenhouse.py` in J-1 so each ATS gets its own module and
the company list lives in `profile/portals.yml`. Pure HTTP/JSON, no LLM
spend on discovery. Each posting is title-pre-filtered before scoring.

Discovery is location-agnostic (P0.1, HUNT2 session 47 — owner directive):
location preference is enforced entirely per-user at scoring/ranking time
(P0.7); every role this board publishes lands in the pool.
"""

import logging
from datetime import datetime, timezone

from jobify.shared.html import strip_tags
from jobify.shared.jobid import make_job_id
from sources._http import fetch_json, passes_title_filter, sleep_between_requests
from sources._portals import companies, title_signals
from sources.remote_infer import infer_remote

logger = logging.getLogger("sources.lever")


# Last-resort fallback if portals.yml is missing. Canonical list lives there.
_FALLBACK_COMPANIES: list[tuple[str, str]] = []


def _created_at_iso(job: dict) -> str | None:
    """Lever's `createdAt` is epoch milliseconds; postings.posted_at is
    TIMESTAMPTZ, so convert to ISO 8601. Missing/malformed is None, never
    guessed."""
    raw = job.get("createdAt")
    if not isinstance(raw, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(raw / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _fetch_one(slug: str, display_name: str, apply_title_filter: bool = True):
    """Fetch open roles from a single Lever board.

    ``apply_title_filter=False`` skips the process-global-profile title
    gate entirely — used by the H4 hosted discovery worker
    (``jobify.hosted.discovery``), which fetches into the SHARED postings
    pool and must not let one arbitrary profile's title/seniority
    preferences drop a posting before any other hosted user ever sees it.
    Per-user title filtering happens downstream, in Task 3's fan-out.
    """
    url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
    data = fetch_json(url, log=logger, label=slug)
    if data is None:
        return

    raw = 0
    yielded = 0
    skipped_title = 0
    for job in data:
        raw += 1
        title = job.get("text", "")
        categories = job.get("categories") or {}
        location = categories.get("location", "Unknown")
        description = job.get("descriptionPlain") or ""
        if not description:
            parts: list[str] = []
            for section in job.get("lists") or []:
                parts.append(section.get("text", ""))
                parts.append(strip_tags(section.get("content", "")))
            description = "\n".join(parts)
        link = job.get("hostedUrl") or job.get("applyUrl") or ""

        if apply_title_filter and not passes_title_filter(title):
            skipped_title += 1
            continue

        signals = title_signals(title)
        if signals["prefer"] or signals["seniority"]:
            logger.debug("lever: %s title signals %s on %r", slug, signals, title)

        yielded += 1
        yield {
            "id": make_job_id(link, title, display_name),
            "source": "lever",
            "query": "",
            "title": title,
            "company": display_name,
            "location": location,
            "remote": infer_remote(location, job),
            "description": description[:3000],
            "url": link,
            "posted_at": _created_at_iso(job),
            "department": categories.get("department") or None,
            "employment_type": categories.get("commitment") or None,
            "raw": job,
        }
    logger.info(
        "lever: %s yielded=%d (raw=%d, title-filtered=%d)",
        slug, yielded, raw, skipped_title,
    )


def fetch(targets: list[tuple[str, str]] | None = None, apply_title_filter: bool = True):
    """Yield job dicts from every Lever board listed in portals.yml.

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
    boards = targets if targets is not None else (companies("lever") or _FALLBACK_COMPANIES)
    for slug, name in boards:
        yield from _fetch_one(slug, name, apply_title_filter=apply_title_filter)
        sleep_between_requests()
