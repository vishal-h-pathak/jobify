"""sources/_portals.py — Shared portal-config + title-filter helpers (J-1).

Loads `portals.yml` (canonical user-layer ATS map) via
``jobify.profile_loader`` and exposes:

- `companies(platform)` — list of (slug, name) tuples for a given ATS
- `passes_title_filter(title)` — cheap pre-filter so we skip LLM scoring
  on obvious leadership / non-engineering postings
- `title_signals(title)` — debug helper returning matched
  prefer/seniority substrings (logged but doesn't gate filtering)

The fallback path keeps the hunter running if `portals.yml` is missing
— `companies()` returns an empty list, `passes_title_filter()` returns
True. This makes the move from hard-coded lists to YAML opt-in.

WS-A1: the portal map resolves through the consolidated profile directory
(``jobify.profile_loader.load_portals``) instead of a hunt-local path, so
``JOBIFY_PROFILE_DIR`` (or the active ``profile/`` / shipped
``profile.example/``) governs which boards are polled.

H4: every function here takes an optional ``profile_dir`` argument. Omit
it (the single-user `jobify-hunt` call sites all do) and it resolves
through ``_PORTALS_CACHE``, a process-global cache keyed to the ONE
profile a `jobify-hunt` process ever serves. Pass an explicit
``profile_dir`` (e.g. the `Path` a fan-out worker got back from
``jobify.profile_loader.materialize_profile_dir(user_id)``) and it reads
straight through, uncached, so many users' portal maps can be read in one
process without one user's config leaking into another's.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable, Optional

from jobify import profile_loader

logger = logging.getLogger("sources._portals")

_PORTALS_CACHE: Optional[dict] = None


def _load_portals(profile_dir: Optional[Path] = None) -> dict:
    """Return parsed `portals.yml`.

    ``profile_dir=None`` (every existing `jobify-hunt` call site) uses the
    process-global ``_PORTALS_CACHE`` backing the single active profile.
    An explicit ``profile_dir`` bypasses that cache entirely — it must
    never populate it or read from it, or a fan-out worker iterating
    multiple users would serve the first user's portals to everyone else.
    """
    global _PORTALS_CACHE
    if profile_dir is not None:
        return profile_loader.load_portals(profile_dir)
    if _PORTALS_CACHE is None:
        _PORTALS_CACHE = profile_loader.load_portals()
    return _PORTALS_CACHE


def companies(platform: str, profile_dir: Optional[Path] = None) -> list[tuple[str, str]]:
    """Return [(slug, name), ...] for a given ATS platform.

    Returns [] if the platform is missing from `portals.yml` so callers
    can keep their existing in-module hard-coded fallbacks during the
    cutover.
    """
    cfg = _load_portals(profile_dir).get(platform) or {}
    rows = cfg.get("companies") or []
    out: list[tuple[str, str]] = []
    for row in rows:
        slug = (row.get("slug") or "").strip()
        name = (row.get("name") or slug).strip()
        if slug:
            out.append((slug, name))
    return out


def workday_tenants(profile_dir: Optional[Path] = None) -> list[dict]:
    """Workday rows carry richer metadata than slug+name (tenant, site, dc).

    Returns the raw list of dicts from `portals.yml::workday.companies`.
    Each dict is expected to have at least: tenant, site, dc, name.
    """
    cfg = _load_portals(profile_dir).get("workday") or {}
    return list(cfg.get("companies") or [])


def _filter_cfg(profile_dir: Optional[Path] = None) -> dict:
    return _load_portals(profile_dir).get("title_filter") or {}


def passes_title_filter(title: str, profile_dir: Optional[Path] = None) -> bool:
    """Cheap title pre-filter applied before the LLM scorer touches a job.

    Reject if the title contains any `reject_substrings` term
    (case-insensitive substring match). Otherwise pass — the scorer can
    take it from there. Conservative on purpose: a slightly noisy match
    that survives is cheaper than missing a Tier 1 role.
    """
    if not title:
        return True
    cfg = _filter_cfg(profile_dir)
    rejects: Iterable[str] = cfg.get("reject_substrings") or []
    needle = title.lower()
    for r in rejects:
        if r and r.lower() in needle:
            return False
    return True


def title_signals(title: str, profile_dir: Optional[Path] = None) -> dict:
    """Debug helper: which prefer/seniority substrings matched a title.

    Used for logging only — does not affect filtering. Returns a dict
    {prefer: [...], seniority: [...]} with the matches found.
    """
    cfg = _filter_cfg(profile_dir)
    needle = (title or "").lower()
    prefer = [s for s in (cfg.get("prefer_substrings") or []) if s and s.lower() in needle]
    seniority = [s for s in (cfg.get("seniority_substrings") or []) if s and s.lower() in needle]
    return {"prefer": prefer, "seniority": seniority}
