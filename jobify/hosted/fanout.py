"""jobify.hosted.fanout — per-user scoring ladder (H4 Task 3).

Discovery (Task 2) fills the shared `postings` pool once per cycle; this
module fans OUT from that pool, once per user with a `profiles` row,
through four increasingly expensive stages (see `docs/SCORING.md`):

    1. Title pre-filter    static, per-user `portals.yml`
    2. Compiled rubric     static, per-user, zero tokens/posting
    3. Embedding rerank    cosine(profile embedding, posting embedding)
    4. LLM verdict         Haiku-class, top-N survivors only, budget-gated

Every posting this module considers gets a `matches` row (P0.5, HUNT2
session 47 — "invisible funnel" fix): `status` records which stage it
fell out at (`rejected_title` / `rejected_rubric` / `rejected_rerank` /
`rejected_llm`), or `surfaced` if it made it all the way through a real
stage-4 LLM verdict — see `jobify.shared.match_status` for the canonical
enum. Rejected rows are never zero-score noise in the user's feed: the
web layer filters every read to `status = 'surfaced'`
(`web/lib/db/matches.ts` callers) — a rejected row exists purely so a
cycle's pooled->scored->surfaced shape is reconstructable after the fact
(`select status, count(*) from matches where user_id = ...`), which was
previously impossible. `location_tier` (P0.7 — owner directive) is
persisted on stage-2-survivor rows from `RubricResult.location_tier` and
is what the web feed orders surfaced results by, ahead of score.

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

Cost rails (H6, `planning/session-prompts/15_h6_cost_rails.md`): three
budget layers stack on top of the ladder above — see `docs/COST_RAILS.md`
for the full picture.

    1. Per-user pool cap — `db.get_budget_cap`/`db.get_month_to_date_spend`,
       now re-checked every `HOSTED_BUDGET_RECHECK_EVERY` stage-4 verdicts
       within a single user's top-N loop (mid-batch), not just once per
       batch.
    2. Global pool cap — `HOSTED_GLOBAL_MONTHLY_CAP_USD`, total non-BYO
       spend across every user this month. Exceeded => the cycle degrades
       to stages 1-3 for pool users (no new rubric compiles, no stage-4
       verdicts); feed matches already scored keep working.
    3. BYO keys — a user with an `api_keys` row runs their rubric compile
       and stage-4 verdicts on their OWN decrypted key (per-call client,
       same never-cache-across-users discipline as the profile isolation
       above) and bypasses both caps entirely. A decryption failure
       (`jobify.hosted.keycrypt.KeyDecryptionError` — wrong/rotated
       secret, corrupted row) is logged and falls back to pool-with-caps
       for that user; it never crashes the cycle.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from jobify import db
from jobify.config import (
    HOSTED_BUDGET_RECHECK_EVERY,
    HOSTED_GLOBAL_MONTHLY_CAP_USD,
    HOSTED_MAX_POSTING_AGE_DAYS,
    HOSTED_STAGE4_TOP_N,
)
from jobify.hosted import embed
from jobify.hosted.keycrypt import KeyDecryptionError, decrypt_key
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
    get_materialized_updated_at,
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


def cost_usd(input_tokens: int, output_tokens: int, input_rate: float, output_rate: float) -> float:
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


def _stage4_verdict(
    user_id: str, thesis: str, posting: dict, *, api_key: Optional[str] = None,
    counters: Optional[dict] = None,
) -> Optional[dict]:
    """One stage-4 LLM call for one posting. Always writes the
    `llm_verdict` ledger row (real tokens were spent regardless of
    whether the response parsed); returns `None` (no `matches` write)
    only when the response itself wasn't usable JSON.

    `api_key` (H6 BYO keys): routes this call through the user's own
    decrypted key instead of the pool's, and tags the ledger row
    `byo=True` — see `llm.complete_with_usage`'s docstring for the auth
    semantics. Only included in the `llm.complete_with_usage` call when
    truthy, so pool-path callers (and their tests, which monkeypatch that
    function with the pre-H6 fixed signature) are unaffected.

    `counters` (ADM-2 Task 2): the cycle's fan-out counters dict, if the
    caller is threading one through — when provided, this call's cost
    (the same value written to the `llm_verdict` ledger row) is added to
    `counters["cost_usd"]`. Optional and keyword-only so any direct unit
    test of this helper that doesn't care about cost keeps working
    unchanged.
    """
    call_kwargs: dict = dict(
        system=_STAGE4_SYSTEM,
        prompt=_stage4_user_msg(thesis, posting),
        model=STAGE4_MODEL,
        max_tokens=STAGE4_MAX_TOKENS,
    )
    if api_key:
        call_kwargs["api_key"] = api_key
    text, usage = llm.complete_with_usage(**call_kwargs)
    cost = cost_usd(
        usage.input_tokens, usage.output_tokens,
        STAGE4_INPUT_USD_PER_MTOK, STAGE4_OUTPUT_USD_PER_MTOK,
    )
    db.insert_budget_ledger_row(
        user_id, LLM_VERDICT_EVENT,
        model=STAGE4_MODEL,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cost_usd=cost,
        byo=bool(api_key),
    )
    if counters is not None:
        counters["cost_usd"] = counters.get("cost_usd", 0.0) + cost

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


def targeting_text(profile: dict) -> str:
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


def _ensure_rubric(
    user_id: str, profile_dir: Path, *,
    api_key: Optional[str] = None, allow_new_compile: bool = True,
    counters: Optional[dict] = None,
) -> Optional[dict]:
    """Return `user_id`'s compiled rubric, compiling and persisting it on
    first use. One Sonnet-class call per user, ever (until an explicit
    recompile) — every subsequent cycle reads `profiles.compiled_rubric`
    back via `jobify.db.get_compiled_rubric`.

    `api_key` (H6 BYO keys): routes a NEW compile through the user's own
    decrypted key and tags the ledger row `byo=True` — an existing cached
    rubric is returned as-is regardless (no re-compile just because a key
    was added).

    `allow_new_compile=False` (H6 global pool cap): when the user has no
    cached rubric yet and the global cap is exhausted, don't spend the
    one-time compile call — return `None` instead. BYO callers always
    pass `allow_new_compile=True` (BYO bypasses the global cap); the pool
    path passes `False` when `fanout._global_cap_exceeded()` is true.

    `counters` (ADM-2 Task 2): the cycle's fan-out counters dict, if the
    caller is threading one through — when a new compile happens, this
    call's cost (the same value written to the `rubric_compile` ledger
    row) is added to `counters["cost_usd"]`. Optional and keyword-only so
    any direct unit test of this helper that doesn't care about cost
    keeps working unchanged. Not touched at all on the cached-rubric /
    no-new-compile paths — no cost was incurred.
    """
    existing = db.get_compiled_rubric(user_id)
    if existing:
        return existing
    if not allow_new_compile:
        return None

    thesis = load_thesis(profile_dir)
    disqualifiers_text = load_disqualifiers_text(profile_dir)
    # NB: local var name intentionally differs from the module-level
    # `targeting_text` function (renamed from `_targeting_text`) — reusing
    # the function's own name as a local target here would shadow it for
    # this whole function body and raise UnboundLocalError on this exact
    # line.
    targeting_tier_text = targeting_text(load_profile(profile_dir))

    compile_kwargs: dict = dict(
        thesis=thesis, disqualifiers_text=disqualifiers_text, targeting_text=targeting_tier_text,
    )
    if api_key:
        compile_kwargs["api_key"] = api_key
    data, usage = rubric_module.compile_rubric_with_usage(**compile_kwargs)
    db.set_compiled_rubric(user_id, data)
    cost = cost_usd(
        usage.input_tokens, usage.output_tokens,
        RUBRIC_COMPILE_INPUT_USD_PER_MTOK, RUBRIC_COMPILE_OUTPUT_USD_PER_MTOK,
    )
    db.insert_budget_ledger_row(
        user_id, RUBRIC_COMPILE_EVENT,
        model=rubric_module.COMPILER_MODEL,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cost_usd=cost,
        byo=bool(api_key),
    )
    if counters is not None:
        counters["cost_usd"] = counters.get("cost_usd", 0.0) + cost
    return data


# ── Stage 3 support: profile-embedding staleness bookkeeping ─────────────
#
# `embed.ensure_profile_embedding` recomputes when the caller passes
# `force=True`; deciding WHEN to force is this module's job (per
# `embed.py`'s docstring). We need "has this user's profile changed since
# the LAST time we computed its embedding" — a different question than
# `profile_loader._cache_is_stale` answers ("has the DB row changed since
# the cache dir was last materialized"). No new migration/column: a small
# sibling stamp file lives alongside the existing per-user cache dir,
# recording the `profiles.updated_at` value as of the last embedding
# compute. Compared against `get_materialized_updated_at(profile_dir)`
# (itself a read of `materialize_profile_dir`'s own stamp file — no extra
# DB round-trip either) to decide `force`.
_EMBEDDING_STAMP_FILENAME = ".embedding_stamp"


def _embedding_stamp_path(profile_dir: Path) -> Path:
    return profile_dir / _EMBEDDING_STAMP_FILENAME


def _embedding_is_stale(profile_dir: Path, updated_at: str) -> bool:
    """True when the profile embedding must be recomputed: no prior
    embedding-stamp exists, or it records a different `updated_at` than
    the profile's current materialized value."""
    stamp_path = _embedding_stamp_path(profile_dir)
    if not stamp_path.is_file():
        return True
    return stamp_path.read_text(encoding="utf-8").strip() != str(updated_at).strip()


def _mark_embedding_fresh(profile_dir: Path, updated_at: str) -> None:
    """Record `updated_at` as the profile state the embedding now reflects.
    Only called after a successful recompute — a failed/no-op
    `ensure_profile_embedding` call must leave the stamp stale so the next
    cycle retries rather than silently accepting a missing/outdated vector.
    """
    _embedding_stamp_path(profile_dir).write_text(str(updated_at), encoding="utf-8")


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
    targeting = targeting_text(load_profile(profile_dir)).strip()
    return "\n\n".join(p for p in (thesis, targeting) if p)


def _stage3_embed_rerank(
    user_id: str, profile_dir: Path, survivors: list[tuple[dict, RubricResult]],
    counters: dict,
) -> dict[str, float]:
    """Cosine-rerank stage-2 survivors against the user's profile
    embedding. Returns `{posting_id: embed_score}`; a posting id missing
    from the result means stage 3 didn't score it (embeddings disabled,
    or one of the two vectors came back `None`) — `embed_score` stays
    NULL for it and the ladder proceeds 1 -> 2 -> 4 unaffected, per the
    brief's degradation contract.

    `counters`: the cycle's fan-out counters dict — always a real,
    cycle-level dict (every caller is `_run_user_ladder`, which always has
    one), unlike `_ensure_rubric`/`_stage4_verdict`'s optional `counters`
    param. Threaded through to both `embed.ensure_profile_embedding` and
    `embed.ensure_posting_embedding` so their embedding ledger costs (ADM-2
    final-review fix) land in `counters["cost_usd"]` too, not just
    rubric-compile/stage-4 cost.
    """
    if not embed.embeddings_enabled():
        return {}

    updated_at = get_materialized_updated_at(profile_dir)
    force = _embedding_is_stale(profile_dir, updated_at)
    try:
        recomputed = embed.ensure_profile_embedding(
            user_id, _profile_embed_text(profile_dir), force=force, counters=counters,
        )
        profile_vec = db.get_profile_embedding(user_id)
    except Exception as exc:  # noqa: BLE001 — stage 3 is best-effort, never fatal to the ladder
        logger.error("fanout: profile embedding failed for user_id=%s: %s", user_id, exc)
        return {}
    if recomputed:
        _mark_embedding_fresh(profile_dir, updated_at)
    if profile_vec is None:
        return {}

    scores: dict[str, float] = {}
    for posting, _result in survivors:
        posting_id = posting["id"]
        try:
            embed.ensure_posting_embedding(
                posting_id, _posting_embed_text(posting), counters=counters,
            )
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


# ── Cost rails: BYO key resolution + global pool cap (H6) ────────────────


def _resolve_byo_key(user_id: str) -> Optional[str]:
    """Return `user_id`'s decrypted Anthropic key, or `None` when they
    have no `api_keys` row OR decryption failed. A decryption failure
    (wrong/rotated `JOBIFY_KEY_ENCRYPTION_SECRET`, corrupted row) is
    logged and treated exactly like "no BYO key" — the caller falls back
    to pool-with-caps for this user rather than crashing the cycle.

    Fresh DB read + decrypt on every call, no caching: the per-call,
    never-shared-across-users discipline the module docstring describes
    for profile state applies equally to key material.
    """
    ciphertext = db.get_api_key_ciphertext(user_id)
    if not ciphertext:
        return None
    try:
        return decrypt_key(ciphertext)
    except KeyDecryptionError as exc:
        logger.error(
            "fanout: BYO key decrypt failed for user_id=%s (falling back to "
            "pool-with-caps): %s", user_id, exc,
        )
        return None


def _global_cap_exceeded() -> bool:
    """True when this month's total non-BYO spend, across every user
    (`jobify.db.get_global_month_to_date_spend`), has hit
    `HOSTED_GLOBAL_MONTHLY_CAP_USD` — the "$100 total" pool promise.
    """
    return db.get_global_month_to_date_spend() >= HOSTED_GLOBAL_MONTHLY_CAP_USD


# ── Stage 1.5: pre-LLM cheap filters (comp floor + max age, HUNT2 S3) ────
#
# Cheaper and earlier than the pre-existing `gates.comp_floor_usd` rubric
# gate (`jobify.hunt.rubric.score_posting`, regex-parses a dollar figure
# out of free-text `description`, only runs after a rubric compile): these
# two filters read the STRUCTURED `postings.comp_min`/`comp_max`/
# `posted_at` columns (migration 0016) directly, before any rubric compile
# or LLM spend. Both PASS ON NULL — absent data (no comp floor stated, or
# a posting that doesn't publish comp/date) never disqualifies. A posting
# that fails either writes a `rejected_rubric` row (the funnel enum has no
# separate "pre-filter" bucket — this is the same category as the rubric
# gate: failed a static/cheap check before the expensive stages) with a
# `reject_reason` of `comp_below_floor` or `stale_posting`.

_BARE_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _profile_comp_floor(profile: dict) -> Optional[float]:
    """The user's stated comp floor, from `profile.yml`'s
    `location_and_compensation.target_comp_usd` (a range or single value,
    as a string — e.g. `"175000-205000"`). Takes the LOW end of a range,
    same "no pay cut" semantics as `jobify.hunt.rubric._parse_comp_usd`.
    Returns None (filter no-ops) if the field is absent or unparseable —
    never a guessed floor.
    """
    raw = (profile.get("location_and_compensation") or {}).get("target_comp_usd")
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    values = [float(m.replace(",", "")) for m in _BARE_NUMBER_RE.findall(str(raw))]
    return min(values) if values else None


def _posting_comp_value(posting: dict) -> Optional[float]:
    """The posting's comp CEILING — `comp_max` only — to compare against
    the user's floor.

    Post-merge-review fix: this used to prefer `comp_min`, which rejected
    any posting whose LOW end sat below the user's floor even when its
    high end cleared it — a posting whose stated band straddles the
    floor (e.g. $257K-$335K against a $300K floor) is a real candidate
    for paying at/above the floor and must pass, not be rejected on its
    low end alone. Comparing against `comp_max` means this filter only
    rejects when the posting's ENTIRE published band tops out below the
    floor — the only case where the user's floor is provably unreachable.
    A posting with only `comp_min` published (no `comp_max`) has an
    unknown ceiling and therefore returns None here (filter passes) —
    same null-pass discipline as everywhere else in this module; most
    postings publish neither (comp_min/comp_max only exist since
    migration 0016 and only Ashby publishes them reliably today)."""
    comp_max = posting.get("comp_max")
    return float(comp_max) if comp_max is not None else None


def _posting_age_days(posting: dict) -> Optional[float]:
    """Days since `postings.posted_at`, or None if that column is NULL
    (most postings today — only populated going forward by HUNT2 S3's
    fetcher changes) or unparseable."""
    posted_at = posting.get("posted_at")
    if not posted_at:
        return None
    try:
        posted = datetime.fromisoformat(str(posted_at).replace("Z", "+00:00"))
    except ValueError:
        return None
    if posted.tzinfo is None:
        posted = posted.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - posted).total_seconds() / 86400.0


def _prelim_reject_reason(profile: dict, posting: dict) -> Optional[str]:
    """`comp_below_floor`, `stale_posting`, or None (passes both filters).
    Comp is checked first — an arbitrary but stable ordering for the
    (rare) posting that fails both."""
    floor = _profile_comp_floor(profile)
    if floor is not None:
        comp_value = _posting_comp_value(posting)
        if comp_value is not None and comp_value < floor:
            return "comp_below_floor"

    age_days = _posting_age_days(posting)
    if age_days is not None and age_days > HOSTED_MAX_POSTING_AGE_DAYS:
        return "stale_posting"

    return None


# ── Per-user ladder ─────────────────────────────────────────────────────


def _run_user_ladder(
    user_id: str, counters: dict[str, int], *, global_pool_capped: bool,
) -> None:
    """Run stages 1-4 for one user, mutating `counters` in place.

    Linear flow, no early returns past the validation-status check: every
    stage's input list is simply empty when the prior stage found nothing,
    so the loops below no-op rather than needing their own guard/return.
    `counters["users_processed"]` only increments once, at the very end —
    if anything above raises, it's the caller's job (`run_fanout_cycle`)
    to catch it and count the user as errored instead.

    `global_pool_capped`: `run_fanout_cycle`'s cycle-start snapshot of
    `_global_cap_exceeded()`. Gates whether THIS user may spend a NEW
    rubric compile this cycle (an already-cached rubric is always reused
    regardless). Stage 4's own gate re-checks the global cap fresh (not
    this snapshot) at each mid-batch recheck, so one user's spend crossing
    the cap mid-cycle still stops a LATER user's stage 4 in the same
    cycle — see `_global_cap_exceeded`.
    """
    status = db.get_profile_validation_status(user_id)
    if status == VALIDATION_STATUS_INVALID:
        counters["users_skipped_invalid"] += 1
        logger.info("fanout: skipping user_id=%s (validation_status=invalid)", user_id)
        return

    profile_dir = materialize_profile_dir(user_id)
    postings = db.get_unmatched_postings(user_id)
    counters["postings_considered"] += len(postings)

    # BYO key resolution (H6): a decrypt failure degrades to `None` (pool
    # path) rather than raising — see `_resolve_byo_key`.
    byo_key = _resolve_byo_key(user_id)

    # ── Stage 1: title pre-filter. A failure gets a `rejected_title` row
    # (P0.5) — the ONLY effect this has going forward is that
    # `get_unmatched_postings` won't hand this posting back to this user
    # again; it is never re-title-filtered on a later cycle. ────────────
    survivors: list[dict] = []
    for p in postings:
        if passes_title_filter(p.get("title") or "", profile_dir):
            survivors.append(p)
        else:
            db.upsert_match(
                user_id, p["id"],
                status="rejected_title",
                reject_reason="failed title filter",
            )
            counters["matches_written"] += 1
    counters["passed_title_filter"] += len(survivors)

    # ── Stage 1.5: pre-LLM cheap filters (comp floor + max age, HUNT2 S3,
    # see the module-level comment above `_prelim_reject_reason`). Runs
    # BEFORE the rubric compile below so a user whose whole survivor list
    # filters out here doesn't spend their one-time rubric-compile call on
    # nothing. ────────────────────────────────────────────────────────────
    profile = load_profile(profile_dir)
    prelim_survivors: list[dict] = []
    for p in survivors:
        reason = _prelim_reject_reason(profile, p)
        if reason is None:
            prelim_survivors.append(p)
        else:
            db.upsert_match(
                user_id, p["id"],
                status="rejected_rubric",
                reject_reason=reason,
            )
            counters["matches_written"] += 1
    survivors = prelim_survivors

    # ── Stage 2: compiled rubric. Deferred compile: if this cycle has
    # nothing to score for this user, don't spend the one-time compile
    # call until there's actually something to run it against. A BYO key
    # always may compile (bypasses the global cap); the pool path may not
    # when the global cap is already exhausted (`allow_new_compile`). ───
    rubric_dict: Optional[dict] = None
    if survivors:
        rubric_dict = _ensure_rubric(
            user_id, profile_dir, api_key=byo_key,
            allow_new_compile=bool(byo_key) or not global_pool_capped,
            counters=counters,
        )
        if rubric_dict is None:
            # No cached rubric AND the global pool cap is exhausted (pool
            # path only — BYO never lands here). Feed keeps showing prior
            # matches; this user's new postings wait for a future cycle.
            counters["users_global_capped"] += 1
            logger.info(
                "fanout: user_id=%s has no compiled rubric and the global "
                "pool cap is exceeded; skipping this cycle (retry next cycle)",
                user_id,
            )

    stage2_survivors: list[tuple[dict, RubricResult]] = []
    if rubric_dict is not None:
        for posting in survivors:
            counters["postings_scored"] += 1
            result = rubric_module.score_posting(rubric_dict, posting)
            if result.disqualified:
                # Hard disqualify -> `rejected_rubric` row (P0.5), not a
                # zero-score row. `result.reasons` already reads like the
                # dealbreakers.yml/thesis.md source line that triggered it
                # (rubric.py's disqualifier/gate messages) — good enough
                # as the short `reject_reason` P0.5 asks for.
                db.upsert_match(
                    user_id, posting["id"],
                    rubric_score=result.score,
                    reason="; ".join(result.reasons),
                    reason_source="rubric",
                    status="rejected_rubric",
                    reject_reason="; ".join(result.reasons)[:500],
                )
                counters["matches_written"] += 1
                continue
            stage2_survivors.append((posting, result))

    # ── Stage 3: embedding rerank (skips cleanly when disabled). ────────
    embed_scores = (
        _stage3_embed_rerank(user_id, profile_dir, stage2_survivors, counters)
        if stage2_survivors else {}
    )
    counters["embedded"] += len(embed_scores)

    # Every stage-2 survivor gets written now, status=`rejected_rerank`
    # (P0.5) — "passed rubric, not yet vetted by an LLM verdict this
    # cycle." Stage 4 below UPDATES this same row (same PK, partial
    # upsert) to `surfaced` for whichever ones make the top-N cut and get
    # a usable verdict; anything that doesn't make the cut (budget/global
    # cap, ranked below HOSTED_STAGE4_TOP_N) simply keeps this status —
    # zero extra writes for the common case of "scored fine, just not
    # this cycle's LLM budget." `location_tier` (P0.7) is the compiled
    # rubric's location-fit ranking dimension the web feed orders by.
    for posting, result in stage2_survivors:
        db.upsert_match(
            user_id, posting["id"],
            rubric_score=result.score,
            embed_score=embed_scores.get(posting["id"]),
            reason="; ".join(result.reasons),
            reason_source="rubric",
            status="rejected_rerank",
            location_tier=result.location_tier,
        )
        counters["matches_written"] += 1

    # ── Stage 4: budget-gated LLM verdict for the top-N survivors. ──────
    # A BYO key bypasses both the per-user AND global pool caps entirely
    # (ledger rows still written, tagged byo=True). The pool path is a
    # HARD cap: re-checked every HOSTED_BUDGET_RECHECK_EVERY verdicts
    # within the loop (mid-batch), not just once per batch, against BOTH
    # the per-user cap and a fresh global-cap read (see module docstring).
    if stage2_survivors:
        if not byo_key and global_pool_capped:
            counters["users_global_capped"] += 1
            logger.info(
                "fanout: user_id=%s: global pool cap exceeded; skipping "
                "stage 4 this cycle (rubric+embed scores only)", user_id,
            )
        else:
            per_user_capped = False
            if not byo_key:
                spend = db.get_month_to_date_spend(user_id)
                cap = db.get_budget_cap(user_id)
                if spend >= cap:
                    per_user_capped = True
                    counters["users_budget_stopped"] += 1
                    logger.info(
                        "fanout: user_id=%s at/over budget cap ($%.4f >= $%.4f); "
                        "skipping stage 4 this cycle (rubric+embed scores only)",
                        user_id, spend, cap,
                    )

            if not per_user_capped:
                thesis = load_thesis(profile_dir)
                # P0.7 addendum: with the old gate:location hard reject
                # gone (see rubric.py), tier-3 postings now reach
                # stage2_survivors and would otherwise compete for the
                # capped stage-4 slots on raw score alone — a high-scoring
                # tier-3 posting could displace a lower-scoring tier-1/
                # tier-2 one from ever getting an LLM verdict. Sort
                # location_tier ascending FIRST (a missing tier — should
                # never happen for a non-disqualified survivor, but
                # treated as worst-case rather than crashing — sorts
                # last), composite score descending second, THEN slice
                # to HOSTED_STAGE4_TOP_N — same ordering the web feed
                # applies to surfaced results, just enforced earlier so
                # it also governs cap admission, not only display order.
                ranked = sorted(
                    stage2_survivors,
                    key=lambda pr: (
                        pr[1].location_tier if pr[1].location_tier is not None else 4,
                        -_composite_score(pr[1].score, embed_scores.get(pr[0]["id"])),
                    ),
                )
                for i, (posting, _result) in enumerate(ranked[:HOSTED_STAGE4_TOP_N], start=1):
                    try:
                        verdict = _stage4_verdict(
                            user_id, thesis, posting, api_key=byo_key, counters=counters,
                        )
                    except Exception as exc:  # noqa: BLE001 — one bad call must not drop the rest of the top-N
                        logger.error(
                            "fanout: stage4 verdict failed for user_id=%s posting_id=%s: %s",
                            user_id, posting.get("id"), exc,
                        )
                        continue
                    counters["stage4_calls"] += 1
                    if verdict is not None:
                        # A real, parseable verdict — P0.5: this is the
                        # only path that ever sets `surfaced`. Score is a
                        # continuum, not a second reject threshold (P0
                        # non-goal: "more scoring sophistication" is out
                        # of scope) — a low-scoring verdict still
                        # surfaces, just sorts low; the LLM's own `reason`
                        # already explains a poor fit when applicable.
                        db.upsert_match(
                            user_id, posting["id"],
                            llm_score=verdict["score"],
                            reason=verdict["reason"],
                            reason_source="llm",
                            status="surfaced",
                            reject_reason=None,
                        )
                    else:
                        # Real tokens were spent (ledger row already
                        # written by `_stage4_verdict`) but the response
                        # wasn't usable JSON — P0.5: this used to leave
                        # the row exactly as stage 2 left it (silently
                        # undercounting spend against visible funnel
                        # state); now it's an explicit `rejected_llm` row.
                        db.upsert_match(
                            user_id, posting["id"],
                            status="rejected_llm",
                            reject_reason="LLM verdict unparseable",
                        )

                    # Mid-batch hard-cap recheck (H6) — BYO bypasses this
                    # entirely, so only the pool path re-checks.
                    if not byo_key and i % HOSTED_BUDGET_RECHECK_EVERY == 0:
                        spend = db.get_month_to_date_spend(user_id)
                        cap = db.get_budget_cap(user_id)
                        if spend >= cap:
                            counters["users_budget_stopped"] += 1
                            logger.info(
                                "fanout: user_id=%s hit budget cap mid-batch "
                                "($%.4f >= $%.4f) after %d/%d verdicts this "
                                "cycle; stopping stage 4",
                                user_id, spend, cap, i, min(len(ranked), HOSTED_STAGE4_TOP_N),
                            )
                            break
                        if _global_cap_exceeded():
                            counters["users_global_capped"] += 1
                            logger.info(
                                "fanout: global pool cap exceeded mid-batch "
                                "(user_id=%s, %d/%d verdicts this cycle); "
                                "stopping stage 4",
                                user_id, i, min(len(ranked), HOSTED_STAGE4_TOP_N),
                            )
                            break

    from jobify.hosted import learning  # noqa: PLC0415 — lazy, avoids a fanout<->learning import cycle
    learning.run_learning_pass(user_id, profile_dir, api_key=byo_key, counters=counters)

    counters["users_processed"] += 1


def run_fanout_cycle(user_ids: Optional[list[str]] = None) -> dict[str, int]:
    """Run one fan-out cycle: every user's ladder, one failure at a time
    isolated from the rest.

    `user_ids` defaults to `jobify.db.list_profile_user_ids()` (every
    user with a `profiles` row); an explicit list is a testing/targeting
    hook (score one user without touching the rest of the roster).

    The global pool cap (H6) is snapshotted ONCE here, at cycle start,
    and passed to every user's ladder — see `_run_user_ladder`'s
    docstring for why stage 4's mid-batch recheck re-reads it fresh
    instead of trusting this snapshot for the whole cycle.

    Returns a summary dict for Task 4's cycle-summary log line:
    `users_processed`, `users_skipped_invalid`, `users_errored`,
    `postings_scored`, `matches_written`, `stage4_calls`,
    `users_budget_stopped`, `users_global_capped`, plus (ADM-2 Task 2)
    four additive stage-funnel/cost fields for the `hunt_cycles` row:
    `postings_considered`, `passed_title_filter`, `embedded` (per-user
    counts of stage 1 input / stage 1 survivors / stage 3 scores, summed
    across the cycle), and `cost_usd` (running total of every ledger
    write this cycle, from `_ensure_rubric`, `_stage4_verdict`, and
    `_stage3_embed_rerank`'s embedding calls).
    """
    ids = user_ids if user_ids is not None else db.list_profile_user_ids()

    global_pool_capped = _global_cap_exceeded()
    if global_pool_capped:
        logger.info(
            "fanout: global pool cap exceeded at cycle start ($%.2f); this "
            "cycle's stage-2 compiles + stage-4 verdicts are skipped for "
            "every pool user (BYO users unaffected)",
            HOSTED_GLOBAL_MONTHLY_CAP_USD,
        )

    counters: dict[str, int] = {
        "users_processed": 0,
        "users_skipped_invalid": 0,
        "users_errored": 0,
        "postings_scored": 0,
        "matches_written": 0,
        "stage4_calls": 0,
        "users_budget_stopped": 0,
        "users_global_capped": 0,
        "postings_considered": 0,
        "passed_title_filter": 0,
        "embedded": 0,
        "cost_usd": 0.0,
    }

    for user_id in ids:
        try:
            _run_user_ladder(user_id, counters, global_pool_capped=global_pool_capped)
        except Exception as exc:  # noqa: BLE001 — one user's failure must not abort the cycle
            counters["users_errored"] += 1
            # Live-fire fix (2026-07-19): surface the FIRST ladder failure into
            # the hunt_cycles counters jsonb — a users_errored count with no
            # message forced a blind debugging session (cycle #23: one user
            # errored at stage 2 with cost 0 and the traceback existed only in
            # ephemeral GHA logs). Truncated; first failure only; no PII —
            # user_id prefix + exception text.
            if "first_error" not in counters:
                import traceback as _tb  # noqa: PLC0415

                tail = "".join(_tb.format_exception(type(exc), exc, exc.__traceback__, limit=-4))
                counters["first_error"] = f"{user_id[:8]}: {tail}"[-800:]  # type: ignore[assignment]
            logger.error("fanout: ladder failed for user_id=%s: %s", user_id, exc)

    logger.info("fanout cycle done: %s", counters)
    return counters
