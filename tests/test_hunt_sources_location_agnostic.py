"""tests/test_hunt_sources_location_agnostic.py — P0.1 (HUNT2 session 47,
owner directive): discovery is location-agnostic. No fetcher module under
jobify/hunt/sources/ may reference a hardcoded location constant (the
legacy Atlanta/Georgia filter this session removed, at both the
discovery-fetch layer AND — via jobify/hunt/rubric.py's retired
`gate:location` hard reject — the scoring layer). Location preference is
enforced entirely per-user at scoring/ranking time (P0.7), never at fetch
time.
"""

from __future__ import annotations

import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SOURCES_DIR = _REPO_ROOT / "jobify" / "hunt" / "sources"

# Whole-word, case-insensitive — the historical bug was literally the
# words "Atlanta" / "Georgia" baked into fetch-time filters and queries.
_LOCATION_CONSTANT_RE = re.compile(r"(?i)\batlanta\b|\bgeorgia\b")


def _source_files() -> list[Path]:
    return sorted(p for p in _SOURCES_DIR.glob("*.py") if p.name != "__init__.py")


def test_source_files_exist_to_check():
    # Guards the assertion below against a silently-empty glob (e.g. a
    # path typo that would make the real test vacuously pass).
    assert len(_source_files()) >= 10


def test_no_fetcher_module_references_a_location_constant():
    hits = {
        path.name: _LOCATION_CONSTANT_RE.findall(path.read_text(encoding="utf-8"))
        for path in _source_files()
    }
    hits = {name: matches for name, matches in hits.items() if matches}
    assert not hits, (
        f"these fetcher modules still reference a hardcoded location constant "
        f"(P0.1 regression): {hits}"
    )


def test_config_has_no_location_filter_helpers():
    """The location-filter helpers themselves (not just their callers)
    must be gone — `is_local_or_remote`, `location_filter_enabled`, and
    the two Atlanta/remote substring tuples."""
    import jobify.config as cfg

    for name in (
        "is_local_or_remote", "location_filter_enabled",
        "LOCAL_LOCATION_SUBSTRINGS", "REMOTE_LOCATION_SUBSTRINGS",
    ):
        assert not hasattr(cfg, name), f"jobify.config still exports {name} (P0.1 regression)"
