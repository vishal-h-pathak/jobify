"""jobify.hosted.board_health — HUNT2 P3 S6: per-catalog-board health
polling, dead-board alerting, and propose-only relocation
(planning/HUNT2_SOURCES.md §5, migration 0018).

Job-pipeline decayed silently (C3, C8) — a board going dark or getting
its ATS URL squatted by an impostor was never noticed until a human
happened to look. This module is the fix: `run_board_health_cycle` polls
EVERY `board_catalog` row (not just boards some user's `portals.yml`
references — the whole global catalog) once per hosted cycle, zero LLM,
direct HTTP against each board's own live endpoint (deliberately NOT
reusing `jobify.hunt.sources.*`'s fetchers, which are keyed off per-user
portal UNIONS and title-filtered besides — this module needs every
catalog row polled regardless of whether any user currently references
it, and needs the raw HTTP status code those fetchers collapse away).

Per board, per day (`board_health`'s PK is `(board_id, day)` — a second
poll the same day upserts over the first): `http_status`, live
`posting_count`, and `name_check_ok` — the impostor check
(Greenhouse board-metadata `name` / Ashby `organizationName` vs. the
catalog's own `company_name`) run on EVERY poll, not just at catalog-
admission time (the gap C3 flagged). Lever and Workday expose no such
metadata endpoint; `name_check_ok` stays `None` (exempt) for both,
never `False` (reserved for an actual name mismatch).

Alert conditions -> `board_catalog.status = 'dead'`: HTTP 404/410, live
`posting_count == 0` against a nonzero 90-day baseline (this board has
posted before but hasn't today), or `name_check_ok is False`. A dead
alert also proposes a relocation candidate via
`jobify.hosted.candidates.enqueue(..., evidence_kind="relocation",
skip_catalog_name_dedup=True, allow_auto_admit=False)` — same slug probe
the discovery-loop candidate queue already runs, under the SAME company
name, explicitly barred from ever auto-admitting (a wrong relocation
poisons the pool for every user watching that board slot — an admin
must approve the swap via the ordinary candidates review UI). Once a
board is marked dead, later cycles skip the re-alert/re-enqueue branch
entirely (the dead status is idempotent; `candidate_boards`' own dedup —
ANY status, by normalized_name — would make a repeat enqueue call a
harmless no-op anyway, but skipping it also keeps the per-cycle summary
meaningful: `dead_flagged` counts NEW alerts, not every poll of an
already-known-dead board).
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Optional

import requests

from jobify import db
from jobify.hosted import candidates

logger = logging.getLogger("jobify.hosted.board_health")

_TIMEOUT = 10.0
_BASELINE_WINDOW_DAYS = 90
_NAME_OVERLAP_THRESHOLD = 0.5
_WORD_RE = re.compile(r"[^\w\s]")

_WORKDAY_HEADERS = {
    "User-Agent": "job-hunter/1.0",
    "Accept": "application/json",
    "Content-Type": "application/json",
}
# Enough to tell zero-vs-nonzero apart and give a reasonable telemetry
# count without walking every page on every poll (matches
# `sources.workday.PAGE_SIZE`'s own per-page convention).
_WORKDAY_POLL_LIMIT = 20


def _words(text: str) -> set[str]:
    return set(_WORD_RE.sub(" ", (text or "").lower()).split())


def _name_check_ok(metadata_name: Optional[str], company_name: str) -> Optional[bool]:
    """Token-overlap impostor check between a board's own live metadata
    name and the catalog's recorded `company_name`. `None` (exempt) when
    the ATS exposes no metadata name at all (Lever, Workday) — `False`
    is reserved for the actual impostor signal: the ATS says a DIFFERENT
    company owns this board."""
    if not metadata_name:
        return None
    a, b = _words(company_name), _words(metadata_name)
    if not a or not b:
        return False
    overlap = len(a & b) / max(len(a), len(b))
    return overlap >= _NAME_OVERLAP_THRESHOLD


def _request(url: str, *, method: str = "GET", json_body: Optional[dict] = None):
    """Direct request preserving the real HTTP status code — unlike
    `sources._http.fetch_json`, which collapses 404s and network errors
    alike to `None`. This module's dead-board alert needs to tell a 404
    apart from a transient failure. Returns `(status_code, parsed_json)`;
    either half is `None` on a request-level failure or an unparseable
    body — never raises."""
    try:
        if method == "POST":
            resp = requests.post(url, json=json_body, headers=_WORKDAY_HEADERS, timeout=_TIMEOUT)
        else:
            resp = requests.get(url, timeout=_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 — a poll failure is data (None), never a crash
        logger.warning("board_health: request failed for %r: %s", url, exc)
        return None, None
    try:
        body = resp.json()
    except ValueError:
        body = None
    return resp.status_code, body


def _poll_greenhouse(slug: str, company_name: str) -> dict:
    status, body = _request(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true")
    jobs = body.get("jobs") if isinstance(body, dict) else None
    posting_count = len(jobs) if status == 200 and isinstance(jobs, list) else None

    _, meta = _request(f"https://boards-api.greenhouse.io/v1/boards/{slug}")
    metadata_name = meta.get("name") if isinstance(meta, dict) and isinstance(meta.get("name"), str) else None

    return {
        "http_status": status, "posting_count": posting_count,
        "name_check_ok": _name_check_ok(metadata_name, company_name),
    }


def _poll_ashby(slug: str, company_name: str) -> dict:
    status, body = _request(f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=false")
    jobs = body.get("jobs") if isinstance(body, dict) else None
    posting_count = len(jobs) if status == 200 and isinstance(jobs, list) else None
    metadata_name = (
        body.get("organizationName")
        if isinstance(body, dict) and isinstance(body.get("organizationName"), str)
        else None
    )
    return {
        "http_status": status, "posting_count": posting_count,
        "name_check_ok": _name_check_ok(metadata_name, company_name),
    }


def _poll_lever(slug: str, _company_name: str) -> dict:
    status, body = _request(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    posting_count = len(body) if status == 200 and isinstance(body, list) else None
    # No metadata endpoint exists for Lever — exempt, not failed.
    return {"http_status": status, "posting_count": posting_count, "name_check_ok": None}


def _poll_workday(slug: str, _company_name: str) -> dict:
    parts = slug.split("/")
    if len(parts) != 3:
        logger.warning("board_health: malformed workday slug %r (expected tenant/dc/site)", slug)
        return {"http_status": None, "posting_count": None, "name_check_ok": None}
    tenant, dc, site = parts
    url = f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
    body_req = {"appliedFacets": {}, "limit": _WORKDAY_POLL_LIMIT, "offset": 0, "searchText": ""}
    status, body = _request(url, method="POST", json_body=body_req)
    postings = body.get("jobPostings") if isinstance(body, dict) else None
    posting_count = len(postings) if status == 200 and isinstance(postings, list) else None
    # No metadata endpoint exists for Workday's CXS API either — exempt.
    return {"http_status": status, "posting_count": posting_count, "name_check_ok": None}


_POLLERS = {
    "greenhouse": _poll_greenhouse,
    "ashby": _poll_ashby,
    "lever": _poll_lever,
    "workday": _poll_workday,
}


def poll_board(board: dict) -> dict:
    """Poll one `board_catalog` row (`{id, ats, slug, company_name,
    status}`). Returns `{http_status, posting_count, name_check_ok}` —
    an unrecognized `ats` (shouldn't happen; the catalog's own CHECK
    constraint limits it to the four known platforms) degrades to an
    all-`None` result rather than raising."""
    poller = _POLLERS.get(board.get("ats"))
    if poller is None:
        return {"http_status": None, "posting_count": None, "name_check_ok": None}
    return poller(board["slug"], board.get("company_name") or "")


def _is_dead(result: dict, baseline_nonzero: bool) -> bool:
    if result["http_status"] in (404, 410):
        return True
    if result["name_check_ok"] is False:
        return True
    if result["posting_count"] == 0 and baseline_nonzero:
        return True
    return False


def run_board_health_cycle() -> dict:
    """One pass over the full `board_catalog`: poll every row, record a
    `board_health` row for today, and — on a NEW dead-board alert — flip
    `board_catalog.status` to `'dead'` and propose a relocation
    candidate. Never auto-relocates (see module docstring). One board's
    poll/write failure is logged and counted, never aborts the rest of
    the cycle — same per-item resilience posture as every other hosted-
    cycle module (`discovery._dedup_fetch`, `candidates.run_candidates_cycle`).

    Returns `{"polled", "dead_flagged", "relocation_proposed", "errored"}`
    for the hosted-worker cycle summary
    (`jobify.hosted.worker._run_board_health_pass`).
    """
    boards = db.list_board_catalog_rows()
    today = date.today().isoformat()
    since_day = (date.today() - timedelta(days=_BASELINE_WINDOW_DAYS)).isoformat()
    counters = {"polled": 0, "dead_flagged": 0, "relocation_proposed": 0, "errored": 0}

    for board in boards:
        counters["polled"] += 1
        try:
            result = poll_board(board)
            baseline_nonzero = db.has_nonzero_board_health_baseline(board["id"], since_day)
            db.upsert_board_health_row(
                board_id=board["id"], day=today,
                http_status=result["http_status"],
                posting_count=result["posting_count"],
                name_check_ok=result["name_check_ok"],
            )

            if board.get("status") == "dead" or not _is_dead(result, baseline_nonzero):
                continue

            counters["dead_flagged"] += 1
            logger.warning(
                "board_health: %s/%s (%s) marked dead — http_status=%s posting_count=%s "
                "name_check_ok=%s baseline_nonzero=%s",
                board.get("ats"), board.get("slug"), board.get("company_name"),
                result["http_status"], result["posting_count"], result["name_check_ok"], baseline_nonzero,
            )
            db.update_board_catalog_status(board["id"], status="dead")
            outcome = candidates.enqueue(
                board.get("company_name") or board.get("slug"),
                "relocation",
                skip_catalog_name_dedup=True,
                allow_auto_admit=False,
            )
            if outcome["outcome"] == "inserted":
                counters["relocation_proposed"] += 1
        except Exception as exc:  # noqa: BLE001 — one board's failure must not abort the whole health cycle
            counters["errored"] += 1
            logger.error("board_health: cycle step failed for %s: %s", board.get("slug"), exc)

    logger.info("board_health cycle done: %s", counters)
    return counters
