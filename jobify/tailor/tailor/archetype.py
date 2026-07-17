"""tailor/archetype.py — Archetype classifier + config loader (J-4).

Loads archetype definitions from ``profile.yml::archetypes`` via the
single canonical loader at ``jobify.profile_loader.load_archetypes``.
Classifies a JD into the best-fit archetype with a single Sonnet-class
call, then exposes the archetype config for downstream prompts
(``tailor_resume.md``, ``tailor_cover_letter.md``).

The classifier is intentionally cheap. It reads title + description +
the framings YAML + the canonical thesis (thesis.md, spliced in first
so tier semantics and the wins-on-conflict rule bind routing) — no
full profile injection, no resume.
Output is a single archetype key + confidence; downstream tailoring
prompts get the full framing/emphasis/tone/bullet_template via
``render_archetype_block(key)``.

PR-4 carryover-from-PR-2: replaced the bespoke
``_resolve_profile_yml`` / ``_load_archetypes`` pair (which walked up
to a sibling-repo ``profile/`` from the pre-merge ``job-applicant``
layout) with a delegation to ``jobify.profile_loader.load_archetypes``,
which now resolves to the unified repo-root ``profile/`` directory.
The ``@lru_cache`` on ``profile_loader.profile_dir`` already provides
the memoization the old ``_ARCHETYPES_CACHE`` global used to provide.
"""

from __future__ import annotations

import json
import logging
import os
import re

from jobify.config import TAILOR_CLAUDE_MODEL as CLAUDE_MODEL
from jobify.shared import llm
from jobify.shared.llm import CompletionUsage
from prompts import cached_system_blocks, load_task_prompt
from jobify.profile_loader import load_archetypes

logger = logging.getLogger("tailor.archetype")

# When the classifier can't resolve a JD to a specific lane, fall back to a
# generic archetype rather than a persona-specific key. ``JOBIFY_FALLBACK_ARCHETYPE``
# lets a profile pin its preferred default lane; otherwise we use the LAST
# archetype defined in profile.yml (authors put the most general / lowest-
# priority lane last by convention).
_FALLBACK_KEY_ENV = "JOBIFY_FALLBACK_ARCHETYPE"
# Optional deterministic fast-path lane (see ``_is_tier_1_5``). A profile that
# defines an agentic/applied-AI lane can name it here; absent, tier-1.5 routing
# is simply skipped and the LLM classifier runs.
_AGENTIC_KEY = os.environ.get("JOBIFY_AGENTIC_ARCHETYPE", "").strip()


def _fallback_key(archs: dict) -> str:
    """Resolve the fallback archetype key for the current profile.

    Prefers ``JOBIFY_FALLBACK_ARCHETYPE`` when it names a defined archetype,
    else the last archetype key in profile.yml, else "" when none exist.
    """
    pinned = os.environ.get(_FALLBACK_KEY_ENV, "").strip()
    if pinned and pinned in archs:
        return pinned
    return next(reversed(archs), "") if archs else ""


def _is_tier_1_5(tier) -> bool:
    """True when the scorer tiered this job 1.5 (agentic / applied AI).

    The jobs.tier column is text, so 1.5 may arrive as "1.5" or 1.5.
    """
    try:
        return float(tier) == 1.5
    except (TypeError, ValueError):
        return False


def _load_archetypes() -> dict:
    """Return the parsed ``archetypes:`` block from profile.yml.

    Thin wrapper kept for the call sites below; profile_loader handles
    resolution + caching + the empty-dict fallback when profile.yml is
    missing.
    """
    archs = load_archetypes()
    if not archs:
        logger.warning("profile.yml archetypes block empty — archetype routing disabled")
    return archs


def archetype_keys() -> list[str]:
    """Return the list of valid archetype keys (for tests + classifier)."""
    return list(_load_archetypes().keys())


def archetype_config(key: str) -> tuple[str, dict]:
    """Look up one archetype's config; falls back to the profile's default lane.

    Returns (resolved_key, cfg). The resolved key is `key` if it exists,
    or the profile fallback (see :func:`_fallback_key`) if a fallback was
    applied, or "" if nothing matched at all.
    """
    archs = _load_archetypes()
    if key in archs:
        return key, archs[key]
    fallback = _fallback_key(archs)
    if fallback:
        return fallback, archs[fallback]
    return "", {}


def render_archetype_block(key: str) -> str:
    """Render an archetype's framing/emphasis/tone/bullet template into a
    single string block that downstream prompts inject as
    `{archetype_block}`. Empty string if the key resolves to nothing —
    callers should be ok with that (tailoring still works without
    archetype routing).
    """
    resolved_key, cfg = archetype_config(key)
    if not cfg:
        return ""
    parts = [f"ARCHETYPE: {resolved_key}"]
    if cfg.get("label"):
        parts.append(f"LABEL: {cfg['label']}")
    if cfg.get("framing"):
        parts.append(f"FRAMING:\n{cfg['framing'].strip()}")
    proof = cfg.get("emphasis_proof_points") or []
    if proof:
        bullets = "\n".join(f"- {p}" for p in proof)
        parts.append(f"EMPHASIS PROOF POINTS:\n{bullets}")
    if cfg.get("tone_guidance"):
        parts.append(f"TONE GUIDANCE:\n{cfg['tone_guidance'].strip()}")
    if cfg.get("bullet_template"):
        parts.append(f"BULLET TEMPLATE:\n{cfg['bullet_template'].strip()}")
    return "\n\n".join(parts)


def _archetypes_block_for_classifier() -> str:
    """Render the archetype labels + framings for the classifier prompt."""
    archs = _load_archetypes()
    parts = []
    for key, cfg in archs.items():
        parts.append(
            f"--- {key} ---\n"
            f"label: {cfg.get('label', '')}\n"
            f"framing: {(cfg.get('framing') or '').strip()}"
        )
    return "\n\n".join(parts)


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in response: {text!r}")
    return json.loads(text[start:end + 1])


# Zero-usage sentinel for the branches below that never call the LLM (no
# archetypes configured, tier-1.5 deterministic fast-path) and for the
# classifier-error fallback, where no confirmed usage exists to report.
_ZERO_USAGE = CompletionUsage(input_tokens=0, output_tokens=0)


def _classify_archetype_call(job: dict) -> tuple[dict, CompletionUsage]:
    """Classify a JD into one archetype key with a cheap Sonnet call.

    Returns (result, usage) — result is a dict {archetype, confidence,
    reasoning}, falling back to the profile's fallback lane if the response
    can't be parsed or no archetypes are configured. usage is honestly zero
    on every branch that never calls the LLM (no archetypes configured, the
    tier-1.5 deterministic fast-path, or a classifier error before a usable
    response).

    Shared by `classify_archetype` (text-only, existing callers) and
    `classify_archetype_with_usage` (H4 ledger — Task 5b's hosted worker),
    so prompt construction + parsing stays the single source of truth and
    only the return type forks.
    """
    archs = _load_archetypes()
    if not archs:
        return {
            "archetype": "",
            "confidence": 0.0,
            "reasoning": "no archetypes configured",
        }, _ZERO_USAGE

    # Tier 1.5 routes deterministically when the profile defines an
    # agentic / applied-AI lane (``JOBIFY_AGENTIC_ARCHETYPE``): the scorer
    # only emits 1.5 for agentic engineering roles, which is exactly what
    # that lane frames. Absent such a lane, fall through to the LLM call.
    if _AGENTIC_KEY and _is_tier_1_5(job.get("tier")) and _AGENTIC_KEY in archs:
        return {
            "archetype": _AGENTIC_KEY,
            "confidence": 1.0,
            "reasoning": "tier 1.5 routes deterministically to the agentic builder lane",
        }, _ZERO_USAGE

    prompt = load_task_prompt(
        "classify_archetype",
        archetypes_block=_archetypes_block_for_classifier(),
        job_title=job.get("title", ""),
        company=job.get("company", ""),
        tier=job.get("tier", "unknown"),
        job_desc=(job.get("description", "") or "")[:4000],
    )

    try:
        # Session I: the shared cached system prefix carries the
        # canonical thesis (FIRST profile document) + global rules, so
        # routing binds to thesis tier semantics at cache-read price.
        # Credits-first with subscription-OAuth fallback — see
        # jobify.shared.llm.
        text, usage = llm.complete_with_usage(
            system=cached_system_blocks(),
            prompt=prompt,
            model=CLAUDE_MODEL,
            max_tokens=300,
        )
        result = _extract_json(text)
    except Exception as exc:
        logger.warning("archetype classify failed: %s — falling back", exc)
        return {
            "archetype": _fallback_key(archs),
            "confidence": 0.0,
            "reasoning": f"classifier error: {exc}",
        }, _ZERO_USAGE

    key = (result.get("archetype") or "").strip()
    if key not in archs:
        logger.info("classifier returned unknown archetype %r — using fallback", key)
        key = _fallback_key(archs)
        result["reasoning"] = (result.get("reasoning") or "") + " (fallback applied)"

    result["archetype"] = key
    try:
        result["confidence"] = float(result.get("confidence") or 0.0)
    except (TypeError, ValueError):
        result["confidence"] = 0.0
    return result, usage


def classify_archetype(job: dict) -> dict:
    """Classify a JD into one archetype key with a cheap Sonnet call.

    Returns a dict {archetype, confidence, reasoning}. Falls back to
    `tier_3_mission_ml` if the response can't be parsed or no
    archetypes are configured.
    """
    result, _usage = _classify_archetype_call(job)
    return result


def classify_archetype_with_usage(job: dict) -> tuple[dict, CompletionUsage]:
    """Like `classify_archetype`, but also returns token usage for the
    budget ledger (`jobify.db.insert_budget_ledger_row`) — Task 5b's hosted
    worker. Honest zero usage on the branches that never call the LLM (see
    `_classify_archetype_call`'s docstring). Same result shape and side
    effects as `classify_archetype`."""
    return _classify_archetype_call(job)
