"""jobify.hosted.learning — LIV-1: the incremental feedback learning pass.

Runs once per user at the end of `fanout.py::_run_user_ladder`'s per-user
ladder, after stage 4 — the "scheduled elsewhere (H4/H6)" wiring
`jobify.hunt.rubric`'s own module docstring names for `apply_feedback`/
`needs_recompile`. Reads this user's `posting_reactions` + `matches`
state changes since a watermark stored inside `learned-insights.md`,
re-scores each flagged posting against the CURRENT rubric
(`rubric.score_posting`) to recover which term-groups it matched (never
persisted at score time — `matches` only stores the final score), then
either nudges weights (`apply_feedback`) or fully recompiles
(`compile_rubric_with_usage`), and appends one dated, human-readable
insight line. Zero LLM calls except the rare full-recompile branch.

Never raises: `run_learning_pass` is called unconditionally from every
per-user cycle; a broken learning pass must degrade to "nothing learned
this cycle," never to a broken scoring cycle (this user's matches are
already written by the time this runs).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from jobify import db
from jobify.hosted.fanout import (
    RUBRIC_COMPILE_INPUT_USD_PER_MTOK,
    RUBRIC_COMPILE_OUTPUT_USD_PER_MTOK,
    cost_usd,
    targeting_text,
)
from jobify.hunt import rubric as rubric_module
from jobify.profile_loader import (
    load_disqualifiers_text,
    load_learned_insights,
    load_profile,
    load_thesis,
)

logger = logging.getLogger("jobify.hosted.learning")

RUBRIC_RECOMPILE_EVENT = "rubric_recompile"

# matches.state values this pass treats as feedback signal (the pipeline's
# terminal triage states) — "new"/"seen" carry no signal.
FEEDBACK_MATCH_STATES = ("saved", "dismissed", "applied")

# A term-group's weight must move more than this fraction (relative to its
# PRIOR weight) to be worth a line in learned-insights.md. The reweight
# itself always persists regardless of this threshold — this only gates
# what's worth telling the user about.
INSIGHT_DELTA_THRESHOLD = 0.05

_WATERMARK_RE = re.compile(r"^<!-- last-processed: (?P<iso>\S+) -->\n?")


def _parse_watermark(content: str) -> tuple[Optional[str], str]:
    """Split `content` into (watermark ISO string or None, body with the
    watermark line stripped, if present)."""
    m = _WATERMARK_RE.match(content)
    if not m:
        return None, content
    return m.group("iso"), content[m.end():]


def _event_action(*, source: str, value: str) -> Optional[str]:
    """Map a `posting_reactions.reaction` or `matches.state` value to an
    `apply_feedback` action string (`"save"` / `"dismiss"`).
    `state="applied"` maps to `"save"` — a stronger positive signal than
    a save, and `apply_feedback` has no separate multiplier for it.
    `None` for anything unrecognized (defensive only; both source tables'
    CHECK constraints already restrict values to what's mapped below)."""
    if source == "reaction":
        return "save" if value == "interested" else "dismiss" if value == "not_interested" else None
    if value in ("saved", "applied"):
        return "save"
    if value == "dismissed":
        return "dismiss"
    return None


def _matched_groups(rubric: dict, posting: dict) -> list[str]:
    """Re-run the pure scorer to recover which term-groups this posting
    matched — `matches` rows only ever stored the final score, never the
    per-group breakdown."""
    result = rubric_module.score_posting(rubric, posting)
    return [name for name, weight in result.breakdown.items() if weight > 0]


def _collect_events(
    user_id: str, rubric: dict, watermark_iso: Optional[str],
) -> tuple[list[dict], str]:
    """Return `(events, new_watermark_iso)`. `events` is `apply_feedback`-
    shaped (`{"action": ..., "matched_groups": [...]}`), built from every
    `posting_reactions` + qualifying `matches` row newer than
    `watermark_iso` (or every row that exists, if `watermark_iso` is
    `None` — the first-ever pass). `new_watermark_iso` is the max
    timestamp actually processed (unchanged/empty if nothing qualified)."""
    reactions = db.get_posting_reactions(user_id)
    matches = db.get_matches_by_states(user_id, list(FEEDBACK_MATCH_STATES))

    candidates: list[tuple[str, Optional[str], str]] = []  # (timestamp, posting_id, action)
    for row in reactions:
        ts = row.get("created_at") or ""
        if watermark_iso and ts <= watermark_iso:
            continue
        action = _event_action(source="reaction", value=row.get("reaction") or "")
        if action:
            candidates.append((ts, row.get("posting_id"), action))
    for row in matches:
        ts = row.get("state_changed_at") or ""
        if watermark_iso and ts <= watermark_iso:
            continue
        action = _event_action(source="match", value=row.get("state") or "")
        if action:
            candidates.append((ts, row.get("posting_id"), action))

    if not candidates:
        return [], (watermark_iso or "")

    posting_ids = [pid for _, pid, _ in candidates if pid]
    postings_by_id = {p["id"]: p for p in db.get_postings_by_ids(posting_ids)}

    events = [
        {
            "action": action,
            "matched_groups": _matched_groups(rubric, postings_by_id[pid]) if pid in postings_by_id else [],
        }
        for _, pid, action in candidates
    ]
    new_watermark = max(ts for ts, _, _ in candidates)
    return events, new_watermark


def _weight_deltas(old_rubric: dict, new_rubric: dict) -> dict[str, float]:
    """`{group_name: relative_change}` for every group present in both
    rubrics (`apply_feedback` never adds/removes groups, only mutates
    `weight` in place, so the two group sets are always identical in
    practice — this still guards defensively via `.get(name, old_w)`)."""
    old_weights = {g["group"]: float(g.get("weight", 0) or 0) for g in old_rubric.get("term_groups", []) or []}
    new_weights = {g["group"]: float(g.get("weight", 0) or 0) for g in new_rubric.get("term_groups", []) or []}
    return {
        name: (new_weights.get(name, old_w) - old_w) / old_w
        for name, old_w in old_weights.items()
        if old_w
    }


def _insight_line(date: str, events: list[dict], deltas: dict[str, float]) -> Optional[str]:
    """One combined bullet line for every group whose weight moved more
    than `INSIGHT_DELTA_THRESHOLD`, e.g.:
    `- 2026-07-16: downweighted "agency work" after 3 dismissals;
    upweighted "platform ownership" after 2 saves`. `None` if nothing
    crossed the threshold this pass (the reweight still persists — this
    only gates the human-readable line)."""
    clauses = []
    for name, delta in deltas.items():
        if abs(delta) <= INSIGHT_DELTA_THRESHOLD:
            continue
        direction = "upweighted" if delta > 0 else "downweighted"
        action = "save" if delta > 0 else "dismiss"
        count = sum(1 for e in events if e["action"] == action and name in e["matched_groups"])
        noun = "save" if action == "save" else "dismissal"
        clauses.append(f'{direction} "{name}" after {count} {noun}{"" if count == 1 else "s"}')
    if not clauses:
        return None
    return f"- {date}: {'; '.join(clauses)}"


def run_learning_pass(
    user_id: str, profile_dir: Path, *, api_key: Optional[str] = None,
    counters: Optional[dict] = None,
) -> None:
    """Entry point — see module docstring. Never raises."""
    try:
        _run_learning_pass_inner(user_id, profile_dir, api_key=api_key, counters=counters)
    except Exception as exc:  # noqa: BLE001 — must never break the scoring cycle
        logger.error("learning: pass failed for user_id=%s: %s", user_id, exc)


def _run_learning_pass_inner(
    user_id: str, profile_dir: Path, *, api_key: Optional[str], counters: Optional[dict],
) -> None:
    rubric = db.get_compiled_rubric(user_id)
    if not rubric:
        return  # nothing to learn against yet

    content = load_learned_insights(profile_dir)
    watermark_iso, body = _parse_watermark(content)

    events, new_watermark = _collect_events(user_id, rubric, watermark_iso)
    if not events:
        return  # nothing new since the last pass — cheap no-op, no writes at all

    today = new_watermark[:10] if new_watermark else ""
    insight_line: Optional[str] = None

    if rubric_module.needs_recompile(events):
        compile_kwargs: dict = dict(
            thesis=load_thesis(profile_dir),
            disqualifiers_text=load_disqualifiers_text(profile_dir),
            targeting_text=targeting_text(load_profile(profile_dir)),
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
            user_id, RUBRIC_RECOMPILE_EVENT,
            model=rubric_module.COMPILER_MODEL,
            input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
            cost_usd=cost, byo=bool(api_key),
        )
        if counters is not None:
            counters["cost_usd"] = counters.get("cost_usd", 0.0) + cost
            counters["learning_recompiles"] = counters.get("learning_recompiles", 0) + 1
        insight_line = f"- {today}: rubric recompiled from scratch after {len(events)} feedback events"
    else:
        new_rubric = rubric_module.apply_feedback(rubric, events)
        db.set_compiled_rubric(user_id, new_rubric)
        insight_line = _insight_line(today, events, _weight_deltas(rubric, new_rubric))

    if counters is not None:
        counters["learning_events_applied"] = counters.get("learning_events_applied", 0) + len(events)

    lines = [line for line in body.split("\n") if line.strip()]
    if insight_line is not None:
        lines.append(insight_line)
    new_body = "\n".join(lines) + ("\n" if lines else "")
    new_content = f"<!-- last-processed: {new_watermark} -->\n{new_body}"

    (profile_dir / "learned-insights.md").write_text(new_content, encoding="utf-8")
    db.update_profile_doc_file(user_id, "learned-insights.md", new_content)
