"""jobify.hosted.fanout — per-user scoring ladder (H4 Task 3).

Discovery (Task 2) fills the shared `postings` pool once per cycle; this
module fans OUT from that pool, once per user with a `profiles` row,
through four increasingly expensive stages (see `docs/SCORING.md`):

    1. Title pre-filter    static, per-user `portals.yml`
    2. Compiled rubric     static, per-user, zero tokens/posting
    3. Embedding rerank    cosine(profile embedding, posting embedding)
    4. LLM verdict         Haiku-class, top-N survivors only, budget-gated

A posting that fails stage 1 (title filter) or is hard-disqualified by
stage 2 (rubric) gets NO `matches` row for that user — not a zero-score
row. Surfacing every rejected posting at score 0 would pollute the feed
with noise the user never asked to see; the single-user pipeline's own
title pre-filter has the same "just never surfaced" semantics.

Cross-user isolation (the known gotcha this task exists to close): every
profile read in this module goes through `jobify.profile_loader`'s
dir-parameterized loaders with an explicit `profile_dir` — never the
process-global, zero-arg `profile_dir()` / `_PORTALS_CACHE` /
`build_profile_prompt_string()` paths the single-user CLI uses. Stage 4's
prompt is a purpose-built one built directly in this module (not
`jobify.hunt.scorer.score_job`, which routes through
`jobify.hunt.prompts.build_profile_prompt_string()` — a zero-arg,
process-global-cached function that can only ever serve one user per
process) for exactly that reason: it never touches a cache that could
leak one user's thesis into another's call in the same fan-out cycle.
See `tests/test_hosted_fanout.py::test_stage4_never_leaks_profile_across_users`.

One user's failure (a broken profile, a rubric-compile error, a bad LLM
response) must not abort the rest of the cycle — every per-user ladder
run is wrapped in `run_fanout_cycle`'s try/except, same resilience
pattern `jobify.hosted.discovery` and `jobify.hunt.agent.iter_all_jobs`
both already use.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
from pathlib import Path
from typing import Optional

from jobify import db
from jobify.config import HOSTED_STAGE4_TOP_N
from jobify.hosted import embed
from jobify.hunt import rubric as rubric_module
# Plain module import (not a specific name) — `jobify.hunt.agent`'s
# top-level sys.path bootstrap is what makes the bare `sources` package
# below importable. `jobify.hosted.discovery` needs the same bootstrap
# and gets it as a side effect of importing a function it actually uses;
# fanout has no use for anything else in `agent`, so it imports the
# module itself purely for that side effect.
import jobify.hunt.agent  # noqa: F401
from jobify.hunt.rubric import RubricResult
from jobify.profile_loader import (
    VALIDATION_STATUS_INVALID,
    load_disqualifiers_text,
    load_profile,
    load_thesis,
    materialize_profile_dir,
)
from jobify.shared import llm
from sources._portals import passes_title_filter

logger = logging.getLogger("jobify.hosted.fanout")

RUBRIC_COMPILE_EVENT = "rubric_compile"
LLM_VERDICT_EVENT = "llm_verdict"

# Haiku-class per docs/SCORING.md's stage-4 line ("Haiku fit+legitimacy,
# top-N survivors"). A real Anthropic model id starting with
# "claude-haiku" — `jobify.shared.llm._oauth_model` already maps that
# prefix to the OAuth-path alias "haiku"; this is not an alias itself.
STAGE4_MODEL = "claude-haiku-4-5"
STAGE4_MAX_TOKENS = 300

# Pricing, USD per million tokens — same env-tunable-constant convention
# `jobify.hunt.rescore` uses for its own cost estimate (RESCORE_INPUT_USD_PER_MTOK
# / RESCORE_OUTPUT_USD_PER_MTOK). Approximate published rates for the two
# models this module calls; override via env if pricing changes without
# needing a code change.
RUBRIC_COMPILE_INPUT_USD_PER_MTOK = float(
    os.environ.get("RUBRIC_COMPILE_INPUT_USD_PER_MTOK", "3.0")
)
RUBRIC_COMPILE_OUTPUT_USD_PER_MTOK = float(
    os.environ.get("RUBRIC_COMPILE_OUTPUT_USD_PER_MTOK", "15.0")
)
STAGE4_INPUT_USD_PER_MTOK = float(os.environ.get("STAGE4_INPUT_USD_PER_MTOK", "1.0"))
STAGE4_OUTPUT_USD_PER_MTOK = float(os.environ.get("STAGE4_OUTPUT_USD_PER_MTOK", "5.0"))


def _cost_usd(input_tokens: int, output_tokens: int, input_rate: float, output_rate: float) -> float:
    return round(
        input_tokens / 1_000_000 * input_rate + output_tokens / 1_000_000 * output_rate, 6
    )


# ── Stage 4 prompt (purpose-built — see module docstring) ────────────────

_STAGE4_SYSTEM = """You are a job-fit verdict model for a hosted job-matching \
service. You will be given one candidate's hunting thesis (their own \
canonical statement of what they're looking for, their hard constraints, \
and their energy signals) followed by a single job posting.

Respond with ONLY a JSON object (no prose, no code fences), of the form:

{
  "score": <float 0.0-1.0, overall fit against the thesis>,
  "reason": "<1-2 sentence, specific, plain-language reason a candidate reading their own feed would understand>"
}

Score generously for anything squarely inside the thesis's stated lanes;
score low for anything the thesis names as a disqualifier or an explicit
non-fit. Do not fabricate posting details that aren't present in the text
you were given.
"""


def _stage4_user_msg(thesis: str, posting: dict) -> str:
    return (
        "=== CANDIDATE THESIS ===\n"
        f"{thesis.strip()}\n\n"
        "=== JOB POSTING ===\n"
        f"Title: {posting.get('title') or ''}\n"
        f"Company: {posting.get('company') or ''}\n"
        f"Location: {posting.get('location') or ''}\n"
        f"Description:\n{posting.get('description') or ''}\n"
    )


def _extract_json_object(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in response: {text!r}")
    return json.loads(text[start : end + 1])


def _stage4_verdict(user_id: str, thesis: str, posting: dict) -> Optional[dict]:
    """One stage-4 LLM call for one posting. Always writes the
    `llm_verdict` ledger row (real tokens were spent regardless of
    whether the response parsed); returns `None` (no `matches` write)
    only when the response itself wasn't usable JSON.
    """
    text, usage = llm.complete_with_usage(
        system=_STAGE4_SYSTEM,
        prompt=_stage4_user_msg(thesis, posting),
        model=STAGE4_MODEL,
        max_tokens=STAGE4_MAX_TOKENS,
    )
    db.insert_budget_ledger_row(
        user_id, LLM_VERDICT_EVENT,
        model=STAGE4_MODEL,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cost_usd=_cost_usd(
            usage.input_tokens, usage.output_tokens,
            STAGE4_INPUT_USD_PER_MTOK, STAGE4_OUTPUT_USD_PER_MTOK,
        ),
    )

    try:
        data = _extract_json_object(text)
    except (ValueError, json.JSONDecodeError) as exc:
        logger.warning(
            "fanout: stage4 verdict for posting_id=%s unparseable: %s",
            posting.get("id"), exc,
        )
        return None

    try:
        score = float(data.get("score"))
    except (TypeError, ValueError):
        score = 0.0
    score = max(0.0, min(1.0, score))
    reason = str(data.get("reason") or "").strip()
    return {"score": score, "reason": reason}


# ── Stage 2 support: targeting-tier text + rubric compile/cache ──────────


def _targeting_text(profile: dict) -> str:
    """Render `profile.yml`'s targeting-tier block as text for
    `compile_rubric`'s `targeting_text` input.

    Key confirmed against `onboarding/schema/profile.schema.json` and
    `profile.example/profile.yml`: `what_he_is_looking_for`, a dict of
    `tier_N -> {label, notes, reference_role}` — NOT a generic
    `targeting:` key.
    """
    tiers = profile.get("what_he_is_looking_for")
    if not isinstance(tiers, dict):
        return ""
    lines: list[str] = []
    for tier_key in sorted(tiers):
        tier = tiers[tier_key]
        if not isinstance(tier, dict):
            continue
        lines.append(f"{tier_key}: {tier.get('label', '')}")
        if tier.get("reference_role"):
            lines.append(f"  reference_role: {tier['reference_role']}")
        if tier.get("notes"):
            lines.append(f"  notes: {tier['notes']}")
    return "\n".join(lines)


def _ensure_rubric(user_id: str, profile_dir: Path) -> dict:
    """Return `user_id`'s compiled rubric, compiling and persisting it on
    first use. One Sonnet-class call per user, ever (until an explicit
    recompile) — every subsequent cycle reads `profiles.compiled_rubric`
    back via `jobify.db.get_compiled_rubric`.
    """
    existing = db.get_compiled_rubric(user_id)
    if existing:
        return existing

    thesis = load_thesis(profile_dir)
    disqualifiers_text = load_disqualifiers_text(profile_dir)
    targeting_text = _targeting_text(load_profile(profile_dir))

    data, usage = rubric_module.compile_rubric_with_usage(
        thesis=thesis, disqualifiers_text=disqualifiers_text, targeting_text=targeting_text,
    )
    db.set_compiled_rubric(user_id, data)
    db.insert_budget_ledger_row(
        user_id, RUBRIC_COMPILE_EVENT,
        model=rubric_module.COMPILER_MODEL,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cost_usd=_cost_usd(
            usage.input_tokens, usage.output_tokens,
            RUBRIC_COMPILE_INPUT_USD_PER_MTOK, RUBRIC_COMPILE_OUTPUT_USD_PER_MTOK,
        ),
    )
    return data


# ── Stage 3 support: cosine rerank ────────────────────────────────────────


def _cosine(a: list[float], b: list[float]) -> Optional[float]:
    """Plain-Python cosine similarity — numpy is not a dependency of this
    repo (checked `pyproject.toml` first per the brief) and this is a
    handful of dot-product terms, not worth adding one for.
    """
    if not a or not b or len(a) != len(b):
        return None
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return None
    return dot / (norm_a * norm_b)


def _posting_embed_text(posting: dict) -> str:
    return f"{posting.get('title') or ''}\n{posting.get('description') or ''}"


def _profile_embed_text(profile_dir: Path) -> str:
    thesis = load_thesis(profile_dir).strip()
    targeting = _targeting_text(load_profile(profile_dir)).strip()
    return "\n\n".join(p for p in (thesis, targeting) if p)


def _stage3_embed_rerank(
    user_id: str, profile_dir: Path, survivors: list[tuple[dict, RubricResult]],
) -> dict[str, float]:
    """Cosine-rerank stage-2 survivors against the user's profile
    embedding. Returns `{posting_id: embed_score}`; a posting id missing
    from the result means stage 3 didn't score it (embeddings disabled,
    or one of the two vectors came back `None`) — `embed_score` stays
    NULL for it and the ladder proceeds 1 -> 2 -> 4 unaffected, per the
    brief's degradation contract.
    """
    if not embed.embeddings_enabled():
        return {}

    try:
        embed.ensure_profile_embedding(user_id, _profile_embed_text(profile_dir))
        profile_vec = db.get_profile_embedding(user_id)
    except Exception as exc:  # noqa: BLE001 — stage 3 is best-effort, never fatal to the ladder
        logger.error("fanout: profile embedding failed for user_id=%s: %s", user_id, exc)
        return {}
    if profile_vec is None:
        return {}

    scores: dict[str, float] = {}
    for posting, _result in survivors:
        posting_id = posting["id"]
        try:
            embed.ensure_posting_embedding(posting_id, _posting_embed_text(posting))
            posting_vec = db.get_posting_embedding(posting_id)
        except Exception as exc:  # noqa: BLE001 — one posting's embed failure must not drop the rest
            logger.error(
                "fanout: posting embedding failed for posting_id=%s: %s", posting_id, exc,
            )
            continue
        if posting_vec is None:
            continue
        score = _cosine(profile_vec, posting_vec)
        if score is not None:
            scores[posting_id] = score
    return scores


def _composite_score(rubric_score: float, embed_score: Optional[float]) -> float:
    """Stage-4 top-N ranking key.

    Rubric alone when stage 3 didn't run or didn't score this posting.
    When both are present: an unweighted mean. Documented choice — a
    weighted blend would bake in an arbitrary prior about which signal
    to trust more before any real calibration data exists; an unweighted
    mean keeps both stages' influence on ranking equal until save/dismiss
    feedback (rubric's own feedback loop) gives a reason to skew either
    way.
    """
    if embed_score is None:
        return rubric_score
    return (rubric_score + embed_score) / 2.0


# ── Per-user ladder ─────────────────────────────────────────────────────


def _run_user_ladder(user_id: str, counters: dict[str, int]) -> None:
    """Run stages 1-4 for one user, mutating `counters` in place.

    Linear flow, no early returns past the validation-status check: every
    stage's input list is simply empty when the prior stage found nothing,
    so the loops below no-op rather than needing their own guard/return.
    `counters["users_processed"]` only increments once, at the very end —
    if anything above raises, it's the caller's job (`run_fanout_cycle`)
    to catch it and count the user as errored instead.
    """
    status = db.get_profile_validation_status(user_id)
    if status == VALIDATION_STATUS_INVALID:
        counters["users_skipped_invalid"] += 1
        logger.info("fanout: skipping user_id=%s (validation_status=invalid)", user_id)
        return

    profile_dir = materialize_profile_dir(user_id)
    postings = db.get_unmatched_postings(user_id)

    # ── Stage 1: title pre-filter. A failure gets no matches row. ───────
    survivors = [
        p for p in postings
        if passes_title_filter(p.get("title") or "", profile_dir)
    ]

    # ── Stage 2: compiled rubric. Deferred compile: if this cycle has
    # nothing to score for this user, don't spend the one-time compile
    # call until there's actually something to run it against. ─────────
    rubric_dict = _ensure_rubric(user_id, profile_dir) if survivors else None

    stage2_survivors: list[tuple[dict, RubricResult]] = []
    for posting in survivors:
        counters["postings_scored"] += 1
        result = rubric_module.score_posting(rubric_dict, posting)
        if result.disqualified:
            continue  # hard disqualify -> no matches row, not a zero-score row
        stage2_survivors.append((posting, result))

    # ── Stage 3: embedding rerank (skips cleanly when disabled). ────────
    embed_scores = (
        _stage3_embed_rerank(user_id, profile_dir, stage2_survivors)
        if stage2_survivors else {}
    )

    for posting, result in stage2_survivors:
        db.upsert_match(
            user_id, posting["id"],
            rubric_score=result.score,
            embed_score=embed_scores.get(posting["id"]),
            reason="; ".join(result.reasons),
            reason_source="rubric",
        )
        counters["matches_written"] += 1

    # ── Stage 4: budget-gated LLM verdict for the top-N survivors. ──────
    if stage2_survivors:
        spend = db.get_month_to_date_spend(user_id)
        cap = db.get_budget_cap(user_id)
        if spend >= cap:
            counters["users_budget_stopped"] += 1
            logger.info(
                "fanout: user_id=%s at/over budget cap ($%.4f >= $%.4f); "
                "skipping stage 4 this cycle (rubric+embed scores only)",
                user_id, spend, cap,
            )
        else:
            thesis = load_thesis(profile_dir)
            ranked = sorted(
                stage2_survivors,
                key=lambda pr: _composite_score(pr[1].score, embed_scores.get(pr[0]["id"])),
                reverse=True,
            )
            for posting, _result in ranked[:HOSTED_STAGE4_TOP_N]:
                try:
                    verdict = _stage4_verdict(user_id, thesis, posting)
                except Exception as exc:  # noqa: BLE001 — one bad call must not drop the rest of the top-N
                    logger.error(
                        "fanout: stage4 verdict failed for user_id=%s posting_id=%s: %s",
                        user_id, posting.get("id"), exc,
                    )
                    continue
                counters["stage4_calls"] += 1
                if verdict is None:
                    continue
                db.upsert_match(
                    user_id, posting["id"],
                    llm_score=verdict["score"],
                    reason=verdict["reason"],
                    reason_source="llm",
                )

    counters["users_processed"] += 1


def run_fanout_cycle(user_ids: Optional[list[str]] = None) -> dict[str, int]:
    """Run one fan-out cycle: every user's ladder, one failure at a time
    isolated from the rest.

    `user_ids` defaults to `jobify.db.list_profile_user_ids()` (every
    user with a `profiles` row); an explicit list is a testing/targeting
    hook (score one user without touching the rest of the roster).

    Returns a summary dict for Task 4's cycle-summary log line:
    `users_processed`, `users_skipped_invalid`, `users_errored`,
    `postings_scored`, `matches_written`, `stage4_calls`,
    `users_budget_stopped`.
    """
    ids = user_ids if user_ids is not None else db.list_profile_user_ids()

    counters: dict[str, int] = {
        "users_processed": 0,
        "users_skipped_invalid": 0,
        "users_errored": 0,
        "postings_scored": 0,
        "matches_written": 0,
        "stage4_calls": 0,
        "users_budget_stopped": 0,
    }

    for user_id in ids:
        try:
            _run_user_ladder(user_id, counters)
        except Exception as exc:  # noqa: BLE001 — one user's failure must not abort the cycle
            counters["users_errored"] += 1
            logger.error("fanout: ladder failed for user_id=%s: %s", user_id, exc)

    logger.info("fanout cycle done: %s", counters)
    return counters
