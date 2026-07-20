"""jobify.hunt.rubric — the static half of the scoring ladder (H2).

Stage 2 of the four-stage funnel (see docs/SCORING.md): a rubric compiled
ONCE per user at onboarding time from `thesis.md` + `disqualifiers.yml` +
`profile.yml`'s targeting tiers, then scored against every posting in pure
Python — zero LLM tokens per posting. The compiler is the only LLM call in
this module; it is routed through `jobify.shared.llm` (the same chokepoint
`jobify.hunt.scorer` uses) so cost tracking sees every call in one place —
this module never builds its own Anthropic client.

Three pieces:
    - `compile_rubric` — one LLM call, thesis/disqualifiers/tiers -> rubric
      JSON, validated against `validate_rubric`, retried once on failure.
    - `score_posting` — pure function, rubric + posting -> `RubricResult`.
      Deterministic: same inputs always produce the same output.
    - `apply_feedback` / `needs_recompile` — the save/dismiss feedback loop
      that nudges term-group weights between compiles and flags when a
      fresh LLM recompile (scheduled elsewhere — H4/H6) is warranted.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from jobify.hunt.prompts import load_prompt
from jobify.shared import llm

RUBRIC_VERSION = 1

# Sonnet-class, matching the tailor's default model (jobify/config.py
# TAILOR_CLAUDE_MODEL fallback / jobify/submit/browser/session.py) — this
# is a one-shot-per-user call, not a per-posting one, so it can afford a
# stronger model than the Opus per-posting scorer without moving the
# steady-state cost needle.
COMPILER_MODEL = "claude-sonnet-4-6"
COMPILER_MAX_TOKENS = 3000

_REQUIRED_TOP_LEVEL_KEYS = (
    "rubric_version",
    "term_groups",
    "disqualifiers",
    "gates",
    "tier_hints",
)


# ── Result type ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RubricResult:
    """Output of `score_posting`. `score` is 0.0-1.0; 0.0 whenever
    `disqualified` is True (a disqualifier or a failed hard gate).

    `location_tier` (P0.7, HUNT2 session 47): 1/2/3 location-fit ranking
    dimension, or `None` when scoring short-circuited before it was
    computed (disqualified postings never reach the tiering step — a
    disqualified posting never surfaces regardless of its location, so a
    tier for it is meaningless)."""

    score: float
    tier_hint: Optional[Any]
    reasons: list[str]
    disqualified: bool
    breakdown: dict[str, float] = field(default_factory=dict)
    location_tier: Optional[int] = None


# ── Schema validation ────────────────────────────────────────────────────


def validate_rubric(data: Any) -> list[str]:
    """Return a list of validation error strings (empty = valid).

    Deliberately hand-rolled rather than a jsonschema dependency: the
    shape is small and stable, and this keeps the module importable
    without an optional dependency the compiler retry path needs to run
    synchronously and fast.
    """
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["rubric must be a JSON object"]

    missing = [k for k in _REQUIRED_TOP_LEVEL_KEYS if k not in data]
    if missing:
        errors.append(f"missing required key(s): {', '.join(missing)}")
        return errors

    if data.get("rubric_version") != RUBRIC_VERSION:
        errors.append(
            f"rubric_version must be {RUBRIC_VERSION}, got "
            f"{data.get('rubric_version')!r}"
        )

    term_groups = data.get("term_groups")
    if not isinstance(term_groups, list) or not term_groups:
        errors.append("term_groups must be a non-empty list")
    else:
        for i, group in enumerate(term_groups):
            if not isinstance(group, dict):
                errors.append(f"term_groups[{i}]: must be an object")
                continue
            for key in ("group", "weight", "terms"):
                if key not in group:
                    errors.append(f"term_groups[{i}]: missing {key!r}")
            if "weight" in group and not isinstance(group["weight"], (int, float)):
                errors.append(f"term_groups[{i}]: weight must be numeric")
            terms = group.get("terms")
            if "terms" in group and (
                not isinstance(terms, list)
                or not all(isinstance(t, str) for t in terms)
            ):
                errors.append(f"term_groups[{i}]: terms must be a list of strings")

    disqualifiers = data.get("disqualifiers")
    if not isinstance(disqualifiers, list):
        errors.append("disqualifiers must be a list")
    else:
        for i, dq in enumerate(disqualifiers):
            if not isinstance(dq, dict) or "pattern" not in dq or "reason" not in dq:
                errors.append(f"disqualifiers[{i}]: must have 'pattern' and 'reason'")
                continue
            if not isinstance(dq["pattern"], str) or not isinstance(dq["reason"], str):
                errors.append(f"disqualifiers[{i}]: 'pattern'/'reason' must be strings")
                continue
            try:
                re.compile(dq["pattern"])
            except re.error as exc:
                errors.append(
                    f"disqualifiers[{i}]: invalid regex {dq['pattern']!r}: {exc}"
                )

    gates = data.get("gates")
    if not isinstance(gates, dict):
        errors.append("gates must be an object")

    tier_hints = data.get("tier_hints")
    if not isinstance(tier_hints, list):
        errors.append("tier_hints must be a list")
    else:
        for i, hint in enumerate(tier_hints):
            if not isinstance(hint, dict) or "pattern" not in hint or "tier" not in hint:
                errors.append(f"tier_hints[{i}]: must have 'pattern' and 'tier'")
                continue
            if not isinstance(hint["pattern"], str):
                errors.append(f"tier_hints[{i}]: 'pattern' must be a string")
                continue
            try:
                re.compile(hint["pattern"])
            except re.error as exc:
                errors.append(
                    f"tier_hints[{i}]: invalid regex {hint['pattern']!r}: {exc}"
                )

    return errors


# ── Compiler ─────────────────────────────────────────────────────────────


def _extract_json_object(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in response: {text!r}")
    return json.loads(text[start : end + 1])


def _compiler_system() -> str:
    return load_prompt("rubric_compiler")


def compile_rubric(*, thesis: str, disqualifiers_text: str, targeting_text: str) -> dict:
    """Compile a rubric from the three inputs via one Sonnet-class call.

    Retries once (a fresh call, not a repair prompt) if the first response
    isn't valid JSON or fails `validate_rubric`; raises `ValueError` if the
    retry also fails. Routed through `jobify.shared.llm.complete` — the
    same credits-first/OAuth-fallback chokepoint the hunt scorer uses, so
    this call shows up wherever that cost ledger reads from.
    """
    user_msg = (
        "=== thesis.md ===\n"
        f"{thesis.strip()}\n\n"
        "=== disqualifiers.yml ===\n"
        f"{disqualifiers_text.strip()}\n\n"
        "=== targeting tiers (profile.yml) ===\n"
        f"{targeting_text.strip()}\n"
    )

    last_error: Optional[str] = None
    for attempt in range(2):
        text = llm.complete(
            system=_compiler_system(),
            prompt=user_msg,
            model=COMPILER_MODEL,
            max_tokens=COMPILER_MAX_TOKENS,
        )
        try:
            data = _extract_json_object(text)
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = f"invalid JSON: {exc}"
            continue

        errors = validate_rubric(data)
        if not errors:
            return data
        last_error = "; ".join(errors)

    raise ValueError(
        f"rubric compiler: invalid rubric after retry ({last_error})"
    )


def _compile_user_msg(*, thesis: str, disqualifiers_text: str, targeting_text: str) -> str:
    return (
        "=== thesis.md ===\n"
        f"{thesis.strip()}\n\n"
        "=== disqualifiers.yml ===\n"
        f"{disqualifiers_text.strip()}\n\n"
        "=== targeting tiers (profile.yml) ===\n"
        f"{targeting_text.strip()}\n"
    )


def compile_rubric_with_usage(
    *, thesis: str, disqualifiers_text: str, targeting_text: str,
    api_key: Optional[str] = None,
) -> tuple[dict, llm.CompletionUsage]:
    """Same compilation contract as `compile_rubric` (identical retry/
    validate loop, identical inputs), but also returns real token usage
    so a caller can write an accurate `budget_ledger` row (H4 Task 3's
    fan-out: `event='rubric_compile'`).

    Additive sibling, not a replacement: `compile_rubric` keeps calling
    `llm.complete` exactly as before (its own tests monkeypatch that
    call directly) — this function is a separate entry point that calls
    `llm.complete_with_usage` instead, mirroring the same
    additive-bypass pattern H4 Task 1 used on `jobify.profile_loader`'s
    loaders (add a parallel path rather than change an existing one's
    contract). Usage is summed across the (up to two) attempts, since a
    retry still spends real tokens the ledger must account for.

    ``api_key`` (H6 BYO keys): passed through to each
    `llm.complete_with_usage` call — see that function's docstring. Only
    included in the call when truthy, so existing fakes that monkeypatch
    `llm.complete_with_usage` with the pre-H6 fixed signature (no
    `api_key` parameter) keep working unchanged for the pool path.
    """
    user_msg = _compile_user_msg(
        thesis=thesis, disqualifiers_text=disqualifiers_text, targeting_text=targeting_text,
    )

    last_error: Optional[str] = None
    total_input = 0
    total_output = 0
    for attempt in range(2):
        call_kwargs: dict = dict(
            system=_compiler_system(),
            prompt=user_msg,
            model=COMPILER_MODEL,
            max_tokens=COMPILER_MAX_TOKENS,
        )
        if api_key:
            call_kwargs["api_key"] = api_key
        text, usage = llm.complete_with_usage(**call_kwargs)
        total_input += usage.input_tokens
        total_output += usage.output_tokens
        try:
            data = _extract_json_object(text)
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = f"invalid JSON: {exc}"
            continue

        errors = validate_rubric(data)
        if not errors:
            return data, llm.CompletionUsage(
                input_tokens=total_input, output_tokens=total_output,
            )
        last_error = "; ".join(errors)

    raise ValueError(
        f"rubric compiler: invalid rubric after retry ({last_error})"
    )


# ── Scorer ───────────────────────────────────────────────────────────────

# A bare "$165" with no comma grouping or k-suffix is almost never an
# annual comp figure in job-posting prose (hourly rates, unrelated dollar
# amounts) — require >= 1000 or an explicit k-suffix before treating a
# match as a comp figure.
_COMP_RE = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})*)(?:\.\d+)?\s*([kK])?\b")

_DEGREE_REQUIRED_RE = re.compile(
    r"(?i)\b(m\.?s\.?|master'?s|ph\.?d\.?|doctorate)\b.{0,40}\brequired\b"
)
_EQUIVALENT_ESCAPE_RE = re.compile(r"(?i)or equivalent")


def _parse_comp_usd(text: str) -> Optional[float]:
    """Best-effort lowest USD figure mentioned in free text.

    Takes the MINIMUM of every parsed figure (not the max): for a stated
    range ("$120k-$150k") the low end is what "no pay cut" actually gates
    on. Returns None when nothing parses, so the comp gate is skipped
    rather than guessed at.
    """
    values: list[float] = []
    for match in _COMP_RE.finditer(text):
        digits, k_suffix = match.group(1), match.group(2)
        value = float(digits.replace(",", ""))
        if k_suffix:
            value *= 1000
        elif value < 1000:
            continue
        values.append(value)
    return min(values) if values else None


def _degree_gate_hit(text: str) -> bool:
    return bool(_DEGREE_REQUIRED_RE.search(text)) and not _EQUIVALENT_ESCAPE_RE.search(
        text
    )


def _location_tier(loc_gate: Optional[dict], remote: Optional[bool], location: str) -> int:
    """P0.7 (HUNT2 session 47, owner directive) location-fit ranking
    dimension — 1 (best) / 2 / 3 (worst), never a disqualifier.

    Reuses the compiled rubric's existing `gates.location` fields
    (`base_location_substring`, `remote_acceptable`) as the sole
    preferred-metro signal — `profile.yml` only has one `base` city today
    (no metros list), so the compiler's single base-metro substring IS
    "the preferred metro" per session 47's scope decision. This used to
    back a hard reject (see `score_posting`'s gates block); here it's
    read-only ranking input.

    tier 1: remote and the user accepts remote, OR onsite/hybrid inside
            the user's base metro.
    tier 2: `remote` is unknown (`None`) — ambiguous location signal.
    tier 3: everything else — onsite/hybrid outside the base metro (or
            with no base metro stated at all), or remote when the user
            doesn't accept remote.
    """
    if remote is None:
        return 2
    if not isinstance(loc_gate, dict):
        # No location preference was ever compiled for this user — remote
        # is a known signal, but there's no base-metro signal to rank an
        # onsite posting against.
        return 1 if remote else 2
    remote_acceptable = bool(loc_gate.get("remote_acceptable", True))
    base_substr = str(loc_gate.get("base_location_substring") or "").lower()
    if remote:
        return 1 if remote_acceptable else 3
    if base_substr and base_substr in location.lower():
        return 1
    return 3


def score_posting(rubric: dict, posting: dict) -> RubricResult:
    """Pure, deterministic scorer: same `(rubric, posting)` always yields
    an identical `RubricResult`. No I/O, no tokens.

    `posting` is read loosely (matches H1's `postings` row shape but
    tolerates a plain dict with just `title`/`description`/`location`/
    `remote`): missing fields just mean fewer signals to match against,
    never a crash.
    """
    title = str(posting.get("title") or "")
    description = str(posting.get("description") or "")
    location = str(posting.get("location") or "")
    remote = posting.get("remote")

    text = f"{title}\n{description}"
    text_lower = text.lower()

    reasons: list[str] = []
    breakdown: dict[str, float] = {}

    # ── Disqualifiers — short-circuit before spending any more work. ────
    for dq in rubric.get("disqualifiers", []) or []:
        pattern = dq.get("pattern", "")
        if not pattern:
            continue
        try:
            hit = re.search(pattern, text, re.IGNORECASE)
        except re.error:
            continue  # a malformed pattern shouldn't crash scoring
        if hit:
            reasons.append(f"disqualified: {dq.get('reason', pattern)}")
            return RubricResult(
                score=0.0,
                tier_hint=None,
                reasons=reasons,
                disqualified=True,
                breakdown=breakdown,
            )

    # ── Gates — comp floor is a hard reject (thesis: "violating this =
    # score floor, do not surface"). The degree gate is a soft flag,
    # matching jobify.hunt.scorer's existing semantics — a degree-gated
    # posting is still surfaced, just labeled.
    #
    # Location used to be a hard gate here too (P0.1/P0.7, HUNT2 session
    # 47 — owner directive): a posting outside the compiled
    # `base_location_substring` and not acceptable-remote was disqualified
    # outright, which is exactly the discovery-time Atlanta filter's
    # scoring-time twin — it silently starved every user's pool of
    # legitimate out-of-metro roles. Replaced by `_location_tier` below:
    # location is now a ranking dimension, not a filter. A posting is
    # still disqualified for its location ONLY via the ordinary
    # disqualifiers-regex loop above (i.e. the user's own dealbreakers.yml
    # said so explicitly) — never automatically by this gate.
    gates = rubric.get("gates", {}) or {}
    gate_failed = False

    comp_floor = gates.get("comp_floor_usd")
    if isinstance(comp_floor, (int, float)):
        parsed_comp = _parse_comp_usd(description)
        if parsed_comp is not None and parsed_comp < comp_floor:
            gate_failed = True
            reasons.append(
                f"gate:comp — parsed ${parsed_comp:,.0f} below floor "
                f"${comp_floor:,.0f}"
            )

    if gates.get("degree_gate") and _degree_gate_hit(text):
        reasons.append(
            "degree_gated: MS/PhD required with no equivalent-experience "
            "escape hatch"
        )

    if gate_failed:
        return RubricResult(
            score=0.0,
            tier_hint=None,
            reasons=reasons,
            disqualified=True,
            breakdown=breakdown,
        )

    # ── Weighted term groups — presence-based per group, normalized by
    # total possible weight so score is always in [0, 1]. ───────────────
    total_weight = 0.0
    matched_weight = 0.0
    for group in rubric.get("term_groups", []) or []:
        name = group.get("group", "?")
        weight = float(group.get("weight", 0) or 0)
        total_weight += weight
        terms = group.get("terms", []) or []
        hit = any(str(term).lower() in text_lower for term in terms if term)
        breakdown[name] = weight if hit else 0.0
        if hit:
            matched_weight += weight
            reasons.append(f"matched:{name} (+{weight:g})")

    score = (matched_weight / total_weight) if total_weight > 0 else 0.0
    score = max(0.0, min(1.0, score))

    tier_hint: Optional[Any] = None
    for hint in rubric.get("tier_hints", []) or []:
        pattern = hint.get("pattern", "")
        if not pattern:
            continue
        try:
            hit = re.search(pattern, title, re.IGNORECASE)
        except re.error:
            continue
        if hit:
            tier_hint = hint.get("tier")
            break

    if not reasons:
        reasons.append("no term groups matched")

    return RubricResult(
        score=score,
        tier_hint=tier_hint,
        reasons=reasons,
        disqualified=False,
        breakdown=breakdown,
        location_tier=_location_tier(gates.get("location"), remote, location),
    )


# ── Feedback loop ────────────────────────────────────────────────────────

# Bounded multiplicative nudges per save/dismiss event on a matched group.
# +/-5% keeps any single event from swinging a group's weight noticeably;
# repeated consistent feedback compounds toward the clamp instead.
FEEDBACK_SAVE_MULTIPLIER = 1.05
FEEDBACK_DISMISS_MULTIPLIER = 0.95

# Weight clamp: a term group can never fully zero out (min) or dominate
# every other group (max), so accumulated feedback nudges the rubric
# without ever being able to disqualify-by-weight-drift or runaway.
FEEDBACK_WEIGHT_MIN = 0.1
FEEDBACK_WEIGHT_MAX = 10.0

# needs_recompile heuristic constants (nightly-job decision — the
# scheduler wiring itself is H4/H6's job, this just answers yes/no).
NEEDS_RECOMPILE_MIN_EVENTS = 20
NEEDS_RECOMPILE_DISMISS_RATIO = 0.6


def apply_feedback(rubric: dict, events: Iterable[dict]) -> dict:
    """Nudge `term_groups` weights from save/dismiss feedback events.

    Each event: `{"action": "save" | "dismiss", "matched_groups": [<group
    name>, ...]}` — `matched_groups` is expected to be the `breakdown`
    keys a prior `score_posting` call reported as matched for that
    posting. Unknown actions/group names are ignored rather than raising,
    so a slightly malformed event doesn't take down the whole batch.

    Returns a NEW rubric dict; the input is not mutated.
    """
    updated = copy.deepcopy(rubric)
    groups_by_name = {
        group["group"]: group
        for group in updated.get("term_groups", []) or []
        if isinstance(group, dict) and "group" in group
    }

    multipliers = {
        "save": FEEDBACK_SAVE_MULTIPLIER,
        "dismiss": FEEDBACK_DISMISS_MULTIPLIER,
    }

    for event in events:
        multiplier = multipliers.get(event.get("action"))
        if multiplier is None:
            continue
        for group_name in event.get("matched_groups") or []:
            group = groups_by_name.get(group_name)
            if group is None:
                continue
            new_weight = float(group.get("weight", 0) or 0) * multiplier
            group["weight"] = max(
                FEEDBACK_WEIGHT_MIN, min(FEEDBACK_WEIGHT_MAX, new_weight)
            )

    return updated


def needs_recompile(events: Iterable[dict]) -> bool:
    """Heuristic: should the nightly job re-run `compile_rubric` from
    scratch instead of relying on incremental `apply_feedback` nudges?

    True when either enough fresh feedback has accumulated to be worth a
    full LLM pass (`NEEDS_RECOMPILE_MIN_EVENTS`), or dismissals dominate
    saves badly enough (`NEEDS_RECOMPILE_DISMISS_RATIO`) that the static
    rubric looks meaningfully out of calibration.
    """
    events = list(events)
    if not events:
        return False
    if len(events) >= NEEDS_RECOMPILE_MIN_EVENTS:
        return True
    dismiss_count = sum(1 for e in events if e.get("action") == "dismiss")
    return (dismiss_count / len(events)) > NEEDS_RECOMPILE_DISMISS_RATIO
