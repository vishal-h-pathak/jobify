"""jobify.profile_loader — single import surface for the user-layer profile.

Centralizes reads of the eight user-layer profile files so callers across
``jobify.hunt``, ``jobify.tailor``, and ``jobify.submit`` all hit one
consistent loader instead of resolving paths ad-hoc. WS-A1 consolidated the
contract: all eight files (``profile.yml``, ``thesis.md``, ``voice-profile.md``,
``article-digest.md``, ``learned-insights.md``, ``cv.md``, ``disqualifiers.yml``,
``portals.yml``) live under ONE directory that this module resolves. Nothing
outside this module should read a persona file by a hard-coded path.

Resolution order for the profile directory:
  1. ``JOBIFY_PROFILE_DIR`` environment variable, if set and non-empty
     (a real user's generated profile, or a test fixture).
  2. ``<repo_root>/profile/`` if that directory exists (the active user's
     profile — onboarding writes here).
  3. ``<repo_root>/profile.example/`` — the shipped neutral example, so a
     fresh clone with no generated profile still loads *something* valid.

The repo root is found by walking up from this file until ``pyproject.toml``.

A missing profile dir or missing individual file is not fatal: dict loaders
return ``{}`` and string loaders return ``""``. Callers that need a stricter
contract should validate the result.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml


def _walk_up_for_pyproject(start: Path) -> Optional[Path]:
    cur = start.resolve()
    for candidate in (cur, *cur.parents):
        if (candidate / "pyproject.toml").is_file():
            return candidate
    return None


@lru_cache(maxsize=1)
def profile_dir() -> Path:
    """Resolve the user-layer profile directory.

    Honors ``JOBIFY_PROFILE_DIR`` first. Otherwise walks up from this module
    until ``pyproject.toml`` is found and prefers ``<repo_root>/profile`` when
    it exists (the active user's generated profile), falling back to
    ``<repo_root>/profile.example`` so a fresh clone loads the neutral example.
    """
    env_override = os.environ.get("JOBIFY_PROFILE_DIR", "").strip()
    if env_override:
        return Path(env_override).expanduser().resolve()

    repo_root = _walk_up_for_pyproject(Path(__file__))
    if repo_root is None:
        raise RuntimeError(
            "profile_loader: could not locate pyproject.toml walking up from "
            f"{Path(__file__).resolve()}; set JOBIFY_PROFILE_DIR to override."
        )
    active = repo_root / "profile"
    if active.is_dir():
        return active
    return repo_root / "profile.example"


def _read_text(name: str) -> str:
    path = profile_dir() / name
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def _read_yaml(name: str) -> dict:
    text = _read_text(name)
    if not text.strip():
        return {}
    data = yaml.safe_load(text)
    return data if isinstance(data, dict) else {}


def _clear_cache_for_tests() -> None:
    """Reset the cached profile_dir() resolution. Test helper only."""
    profile_dir.cache_clear()


# ── Public loaders ──────────────────────────────────────────────────────────


def load_thesis() -> str:
    """Return `profile/thesis.md` contents (empty string if missing).

    The hunting thesis is the canonical statement of judgment — tiers,
    hard constraints, the degree-gate rule, energy signals. Consumers
    that splice it into LLM prompts must place it FIRST and state that
    it overrides older profile prose on conflict (see
    ``jobify.hunt.prompts.build_profile_prompt_string``).
    """
    return _read_text("thesis.md")


def load_profile() -> dict:
    """Return the full parsed `profile.yml` as a dict."""
    return _read_yaml("profile.yml")


def load_profile_text() -> str:
    """Return the raw text of `profile.yml` (empty string if missing).

    Useful when callers want to splice the file into an LLM prompt
    verbatim — comments and key ordering survive — rather than re-emit a
    parsed dict via ``yaml.safe_dump``. Used by
    ``jobify.hunt.prompts.build_profile_prompt_string``.
    """
    return _read_text("profile.yml")


def load_archetypes() -> dict:
    """Return the `archetypes:` block from `profile.yml` (empty dict if missing)."""
    archetypes = load_profile().get("archetypes")
    return archetypes if isinstance(archetypes, dict) else {}


def load_application_defaults() -> dict:
    """Return the `application_defaults:` block from `profile.yml`.

    Single source of truth for canonical form-fill answers (work auth, start
    date, relocation, in-person, AI-policy ack, previous-interview map).
    """
    defaults = load_profile().get("application_defaults")
    return defaults if isinstance(defaults, dict) else {}


def load_cv() -> str:
    """Return `cv.md` contents (master CV markdown; empty string if missing).

    The single source of truth for resume content. Read by the hunt scorer
    and the tailor; tailoring may *select* and *reorder* from it but never
    invents beyond it.
    """
    return _read_text("cv.md")


def load_disqualifiers() -> dict:
    """Return the parsed `disqualifiers.yml` as a dict (empty dict if missing).

    Shape: ``hard_disqualifiers`` (list) + ``soft_concerns`` (list). Read by
    the scorer to short-circuit / penalize jobs.
    """
    return _read_yaml("disqualifiers.yml")


def load_disqualifiers_text() -> str:
    """Return the raw text of `disqualifiers.yml` (empty string if missing).

    Used when splicing the file verbatim into an LLM prompt (comments and
    ordering survive) rather than re-emitting a parsed dict.
    """
    return _read_text("disqualifiers.yml")


def load_portals() -> dict:
    """Return the parsed `portals.yml` as a dict (empty dict if missing).

    Shape: per-ATS ``{greenhouse,lever,ashby,workday}.companies`` lists plus a
    ``title_filter`` block. Read by the hunt sources (``jobify.hunt.sources``)
    to know which boards to poll and how to pre-filter titles before scoring.
    """
    return _read_yaml("portals.yml")


def load_article_digest() -> str:
    """Return `profile/article-digest.md` contents (empty string if missing)."""
    return _read_text("article-digest.md")


def load_learned_insights() -> str:
    """Return `profile/learned-insights.md` contents (empty string if missing)."""
    return _read_text("learned-insights.md")


def load_voice_profile() -> dict:
    """Parse `profile/voice-profile.md` into a section-keyed dict.

    Splits on top-level `## ` headings; keys are kebab-cased section titles,
    values are the raw section bodies. The full unparsed text is also
    returned under the `raw` key so callers can pass the whole file to an
    LLM unmodified when needed.
    """
    text = _read_text("voice-profile.md")
    out: dict[str, object] = {"raw": text}
    if not text.strip():
        return out

    sections: dict[str, str] = {}
    current_key: Optional[str] = None
    buf: list[str] = []
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            if current_key is not None:
                sections[current_key] = "\n".join(buf).strip()
            title = m.group(1).strip().lower()
            current_key = re.sub(r"[^a-z0-9]+", "-", title).strip("-")
            buf = []
        elif current_key is not None:
            buf.append(line)
    if current_key is not None:
        sections[current_key] = "\n".join(buf).strip()

    out["sections"] = sections
    return out
