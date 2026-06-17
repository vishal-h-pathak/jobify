"""prompts/ — versioned markdown prompts for job-hunter.

Each `.md` file in this folder is a system or user prompt for a specific
LLM call site. `_shared.md` holds global rules (ethics, anti-slop,
specificity) that are prepended once to every prompt loaded via
`load_prompt`.

Prompts are templated with Python's `str.format` — placeholders look like
`{name}` and JSON braces in the body must be doubled (`{{ }}`).

Multiple prompts can be composed in one call:
    load_prompt("agent_common", "agent_prepare", job_title=..., company=...)
joins them in order with `---` separators, with `_shared.md` prepended once.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from jobify import profile_loader

_PROMPTS_DIR = Path(__file__).parent
_REPO_ROOT = _PROMPTS_DIR.parent
_SHARED_CACHE: Optional[str] = None
_PROFILE_CACHE: Optional[str] = None


def _shared() -> str:
    global _SHARED_CACHE
    if _SHARED_CACHE is None:
        _SHARED_CACHE = (_PROMPTS_DIR / "_shared.md").read_text(encoding="utf-8")
    return _SHARED_CACHE


def build_profile_prompt_string() -> str:
    """Build the merged user-layer profile string for LLM prompts.

    Concatenates the user-layer files (whichever exist) in the order:
    ``thesis.md``, ``profile.yml``, ``disqualifiers.yml``, ``cv.md``,
    ``article-digest.md``, ``learned-insights.md``. Each section is
    prefixed with a banner so the LLM can tell which file the content
    came from. ``thesis.md`` is the canonical hunting thesis — it goes
    FIRST and its banner states that it overrides older profile prose
    when they conflict.

    Renamed from ``load_profile`` in PR-3 to disambiguate from
    ``jobify.profile_loader.load_profile`` (which returns a dict).

    WS-A1: every file now resolves through ``jobify.profile_loader`` from
    the single consolidated profile directory — no hunt-local path reads.

    Falls back to legacy ``CLAUDE.md`` only if every loader returns empty
    — keeps the migration cutover safe.
    """
    global _PROFILE_CACHE
    if _PROFILE_CACHE is not None:
        return _PROFILE_CACHE

    sections: list[tuple[str, str]] = [
        ("profile.yml", profile_loader.load_profile_text()),
        ("disqualifiers.yml", profile_loader.load_disqualifiers_text()),
        ("cv.md", profile_loader.load_cv()),
        ("article-digest.md", profile_loader.load_article_digest()),
        # J-11 — Match Agent appends generalizable preferences here.
        # Loaded last so insights override earlier statements when they
        # conflict.
        ("learned-insights.md", profile_loader.load_learned_insights()),
    ]
    parts = []
    thesis = profile_loader.load_thesis()
    if thesis.strip():
        parts.append(
            "========== thesis.md (CANONICAL — read first) ==========\n"
            "The hunting thesis below is the most recent, authoritative "
            "statement of what the candidate is looking for. Where it "
            "conflicts with any other profile document in this prompt, "
            "thesis.md wins.\n\n"
            f"{thesis.strip()}"
        )
    parts += [
        f"========== {label} ==========\n{text.strip()}"
        for label, text in sections
        if text and text.strip()
    ]
    if parts:
        _PROFILE_CACHE = "\n\n".join(parts)
        return _PROFILE_CACHE

    legacy = _REPO_ROOT / "CLAUDE.md"
    _PROFILE_CACHE = legacy.read_text(encoding="utf-8") if legacy.exists() else ""
    return _PROFILE_CACHE


def load_prompt(*names: str, **vars: object) -> str:
    """Load one or more prompts/{name}.md, format placeholders, prepend _shared.md.

    Args:
        *names: Prompt file stems (e.g. `"scorer"`).
        **vars: Substitution variables. JSON braces in templates must be
            doubled to survive `.format()`.

    Returns:
        `_shared.md` + each prompt body, joined with `---` separators.
    """
    parts = [_shared()]
    for n in names:
        body = (_PROMPTS_DIR / f"{n}.md").read_text(encoding="utf-8")
        if vars:
            body = body.format(**vars)
        parts.append(body)
    return "\n\n---\n\n".join(parts)
