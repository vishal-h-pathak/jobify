"""jobify.hunt.sources.slug_probe — zero-LLM company-name -> ATS-board probe.

Python port of ``web/lib/portals/slugProbe.ts`` (HUNT2 P1 S1's TS probe,
used by onboarding's portals-seed flow) for ``jobify.hosted.candidates``
(P2 S4): given a company name, deterministically generates candidate
board slugs and probes Greenhouse/Ashby/Lever's public APIs for a match,
scoring confidence from independent board metadata where an ATS exposes
one.

One REQUIRED improvement over the TS version (cockpit review note from
S2): Greenhouse's ``/v1/boards/{slug}/jobs`` endpoint has no company-name
field, so the TS probe falls back to a token-overlap proxy against the
candidate slug itself for Greenhouse — the same discounted proxy Lever
gets (no metadata endpoint exists at all there). Python instead calls the
board metadata endpoint ``/v1/boards/{slug}`` (no ``/jobs``), which
returns the board's authoritative ``name`` — real independent-metadata
confidence for Greenhouse, matching Ashby's ``organizationName`` path
rather than falling back to the proxy.

Zero LLM tokens. Polite concurrency: a small thread pool (default 3
in-flight requests, mirroring the TS probe's own default) — this module
talks directly to public REST APIs rather than going through
``sources._http``, so it doesn't share that module's synchronous
per-request ``sleep_between_requests`` pacing; the concurrency cap is
this module's own politeness knob instead. Never throws: every per-request
failure (network error, 404, malformed JSON) degrades that one candidate
to "no hit" rather than propagating — the worst case for the whole probe
is ``{"found": False, "reason": ...}``.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

import requests

logger = logging.getLogger("sources.slug_probe")

ATS_ORDER = ("greenhouse", "ashby", "lever")

_STRIP_RE = re.compile(r"[^a-z0-9\s-]")
_SPLIT_RE = re.compile(r"[\s-]+")


def normalize_words(raw: str) -> list[str]:
    text = _STRIP_RE.sub("", (raw or "").lower())
    return [w for w in _SPLIT_RE.split(text) if w]


def generate_slug_candidates(company_name: str) -> list[dict[str, str]]:
    """Deterministic slug guesses for a company name, most-likely first:
    hyphenated, then concatenated (if different), then the first word
    alone (if multi-word and not already covered)."""
    words = normalize_words(company_name)
    if not words:
        return []
    candidates = [{"slug": "-".join(words), "kind": "hyphenated"}]
    concatenated = "".join(words)
    if concatenated != candidates[0]["slug"]:
        candidates.append({"slug": concatenated, "kind": "concatenated"})
    if len(words) > 1 and not any(c["slug"] == words[0] for c in candidates):
        candidates.append({"slug": words[0], "kind": "first-word"})
    return candidates


def _token_overlap(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.0
    set_b = set(b)
    overlap = sum(1 for t in a if t in set_b)
    return overlap / max(len(a), len(b))


def _get_json(url: str, *, timeout: float) -> Optional[Any]:
    try:
        resp = requests.get(url, timeout=timeout)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:  # noqa: BLE001 — never throw, this is a best-effort probe
        logger.debug("slug_probe: fetch failed for %r: %s", url, exc)
        return None


def _titles_from(jobs: list, title_key: str) -> list[str]:
    return [j.get(title_key) for j in jobs if isinstance(j, dict) and j.get(title_key)]


def _probe_greenhouse(company_words: list[str], slug: str, timeout: float) -> Optional[dict]:
    jobs_body = _get_json(
        f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true", timeout=timeout,
    )
    if not isinstance(jobs_body, dict):
        return None
    jobs = jobs_body.get("jobs")
    if not isinstance(jobs, list):
        return None
    # Metadata endpoint — no `/jobs` suffix — returns the board's own
    # authoritative company name (the REQUIRED improvement over the TS
    # probe; see module docstring). A metadata fetch failure degrades to
    # the slug-implied proxy exactly like the TS version, rather than
    # dropping the whole candidate.
    meta = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}", timeout=timeout)
    metadata_name = meta.get("name") if isinstance(meta, dict) and isinstance(meta.get("name"), str) else None
    confidence = (
        _token_overlap(company_words, normalize_words(metadata_name))
        if metadata_name
        else _token_overlap(company_words, normalize_words(slug)) * 0.9
    )
    return {
        "ats": "greenhouse",
        "slug": slug,
        "confidence": round(confidence, 3),
        "live_posting_count": len(jobs),
        "metadata_name": metadata_name,
        "titles": _titles_from(jobs, "title"),
    }


def _probe_ashby(company_words: list[str], slug: str, timeout: float) -> Optional[dict]:
    body = _get_json(
        f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=false", timeout=timeout,
    )
    if not isinstance(body, dict):
        return None
    jobs = body.get("jobs")
    if not isinstance(jobs, list):
        return None
    metadata_name = body.get("organizationName") if isinstance(body.get("organizationName"), str) else None
    confidence = (
        _token_overlap(company_words, normalize_words(metadata_name))
        if metadata_name
        else _token_overlap(company_words, normalize_words(slug)) * 0.9
    )
    return {
        "ats": "ashby",
        "slug": slug,
        "confidence": round(confidence, 3),
        "live_posting_count": len(jobs),
        "metadata_name": metadata_name,
        "titles": _titles_from(jobs, "title"),
    }


def _probe_lever(company_words: list[str], slug: str, timeout: float) -> Optional[dict]:
    body = _get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json", timeout=timeout)
    if not isinstance(body, list):
        return None
    # No metadata endpoint exists for Lever — token-overlap proxy against
    # the candidate slug itself stands, discounted for being unverified
    # against independent metadata (same 0.9 factor the TS probe uses).
    confidence = _token_overlap(company_words, normalize_words(slug)) * 0.9
    return {
        "ats": "lever",
        "slug": slug,
        "confidence": round(confidence, 3),
        "live_posting_count": len(body),
        "metadata_name": None,
        "titles": _titles_from(body, "text"),
    }


_PROBERS = {"greenhouse": _probe_greenhouse, "ashby": _probe_ashby, "lever": _probe_lever}


def _probe_one(company_words: list[str], ats: str, candidate: dict, timeout: float) -> Optional[dict]:
    try:
        return _PROBERS[ats](company_words, candidate["slug"], timeout)
    except Exception as exc:  # noqa: BLE001 — never throw; degrade this one candidate to no hit
        logger.debug("slug_probe: probe failed ats=%s slug=%s: %s", ats, candidate["slug"], exc)
        return None


def probe_company_slug(
    company_name: str, *, timeout: float = 5.0, max_concurrent: int = 3,
) -> dict:
    """Probe Greenhouse/Ashby/Lever for ``company_name``'s ATS board.

    Returns the highest-confidence hit across every (ats, slug-candidate)
    pair tried:
    ``{"found": True, "ats", "slug", "confidence", "live_posting_count",
    "metadata_name", "titles"}`` — ``titles`` is the board's own live
    posting titles as of this probe, included so
    ``jobify.hosted.candidates`` can derive auto-tags without a second
    fetch. Or ``{"found": False, "reason": str}`` if nothing matched on
    any ATS. Never raises — every failure mode collapses to a "no hit"
    candidate or the overall not-found result.
    """
    company_words = normalize_words(company_name)
    candidates = generate_slug_candidates(company_name)
    if not candidates:
        return {"found": False, "reason": "empty company name"}

    tasks = [(ats, c) for ats in ATS_ORDER for c in candidates]
    hits: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, max_concurrent)) as pool:
        futures = [pool.submit(_probe_one, company_words, ats, c, timeout) for ats, c in tasks]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                hits.append(result)

    if not hits:
        return {"found": False, "reason": "no matching board found on any ATS"}

    hits.sort(key=lambda h: h["confidence"], reverse=True)
    best = dict(hits[0])
    best["found"] = True
    return best


def probe_known_slug(company_name: str, ats: str, slug: str, *, timeout: float = 5.0) -> dict:
    """Verify a SPECIFIC ``(ats, slug)`` pair already known from strong
    evidence (an embedded ATS URL parsed straight out of an HN comment or
    a SerpAPI dork result) rather than guessing slug candidates from the
    company name. Same result shape as `probe_company_slug`'s hit —
    including `metadata_name` where the ATS exposes one, so a known-slug
    candidate is still eligible for confidence-gated auto-admit, not just
    the guessed-slug path. Never raises.
    """
    if ats not in _PROBERS:
        return {"found": False, "reason": f"unsupported ats: {ats}"}
    company_words = normalize_words(company_name)
    result = _probe_one(company_words, ats, {"slug": slug}, timeout)
    if result is None:
        return {"found": False, "reason": "no matching board at that slug"}
    result = dict(result)
    result["found"] = True
    return result
