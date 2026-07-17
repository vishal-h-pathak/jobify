"""
tailor/cover_letter.py — Claude-powered cover letter generation.

Generates a personalized cover letter for each job application.
"""

import logging
from datetime import datetime

from jobify.config import TAILOR_CLAUDE_MODEL as CLAUDE_MODEL
from jobify.shared import llm
from jobify.shared.llm import CompletionUsage
from jobify.tailor.paths import CANDIDATE_PROFILE_PATH
from prompts import cached_system_blocks, degree_gate_block, load_task_prompt
from tailor.archetype import classify_archetype, render_archetype_block

logger = logging.getLogger("tailor.cover_letter")


def _generate_cover_letter_call(
    job: dict, resume_tailoring: dict = None,
) -> tuple[dict, CompletionUsage]:
    """Build the prompt, call the LLM, and assemble the cover-letter result.

    Shared by `generate_cover_letter` (text-only, existing callers) and
    `generate_cover_letter_with_usage` (H4 ledger — Task 5b's hosted
    worker), so prompt construction stays the single source of truth and
    only the return type forks.
    """
    job_desc = job.get("description", "")
    job_title = job.get("title", "Unknown")
    company = job.get("company", "Unknown")

    context = ""
    if resume_tailoring:
        context = f"""
RESUME TAILORING CONTEXT (maintain consistency with these choices):
- Summary: {resume_tailoring.get('tailored_summary', '')}
- Emphasis areas: {', '.join(resume_tailoring.get('emphasis_areas', []))}
- Keywords: {', '.join(resume_tailoring.get('keywords_to_include', []))}
"""

    # Optional Match Agent transcript — direct quotes from the candidate's
    # own conversation about this role, captured in the dashboard chat. When
    # present, the cover letter should ground its angle, anecdotes, and
    # framing in what they actually said rather than in generic inferences.
    match_chat = (job.get("match_chat_transcript") or "").strip()
    match_chat_block = (
        f"\n\nMATCH AGENT INTERVIEW (the candidate's own answers about THIS role — "
        f"use their framing, motivations, and emphasis areas verbatim where they "
        f"fit. If a draft cover letter or bullet suggestions appear at the end "
        f"of the transcript, treat them as a starting reference, not as final "
        f"output — rewrite anything that doesn't match their voice profile):\n"
        f"{match_chat}\n"
        if match_chat else ""
    )

    # Archetype (J-4). Reuse the resume-tailoring run's classification
    # if present (`resume_tailoring['_archetype']`); otherwise reuse the
    # job's stash; otherwise classify here.
    archetype_meta = (
        (resume_tailoring or {}).get("_archetype")
        or job.get("_archetype")
        or classify_archetype(job)
    )
    job["_archetype"] = archetype_meta
    archetype_block = render_archetype_block(archetype_meta.get("archetype", ""))

    prompt = load_task_prompt(
        "tailor_cover_letter",
        job_title=job_title,
        company=company,
        job_desc=job_desc,
        tier=job.get("tier", "unknown"),
        context=context,
        match_chat_block=match_chat_block,
        archetype_block=archetype_block,
        degree_gate_block=degree_gate_block(job),
    )

    # Session I: static rules + profile + voice ride in the cached
    # system prefix; only the per-job prompt above goes uncached.
    # Credits-first with subscription-OAuth fallback — see jobify.shared.llm.
    cover_letter_text, usage = llm.complete_with_usage(
        system=cached_system_blocks(),
        prompt=prompt,
        model=CLAUDE_MODEL,
        max_tokens=1500,
    )
    cover_letter = cover_letter_text.strip()

    logger.info(f"Cover letter generated for {company} — {job_title}")
    return {"cover_letter": cover_letter}, usage


def generate_cover_letter(job: dict, resume_tailoring: dict = None) -> dict:
    """
    Generate a tailored cover letter for a specific job posting.

    Args:
        job: Dict with job details (title, company, description, etc.)
        resume_tailoring: Optional output from tailor_resume() to maintain consistency.

    Returns:
        Dict with:
            - cover_letter: str — the full cover letter text
            - output_path: str — path to the saved file
    """
    result, _usage = _generate_cover_letter_call(job, resume_tailoring)
    return result


def generate_cover_letter_with_usage(
    job: dict, resume_tailoring: dict = None,
) -> tuple[dict, CompletionUsage]:
    """Like `generate_cover_letter`, but also returns token usage for the
    budget ledger (`jobify.db.insert_budget_ledger_row`) — Task 5b's hosted
    worker. Same result shape and side effects as `generate_cover_letter`;
    see `_generate_cover_letter_call` for the shared implementation."""
    return _generate_cover_letter_call(job, resume_tailoring)
