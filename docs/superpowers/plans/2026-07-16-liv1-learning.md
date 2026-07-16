# LIV-1 — the living profile: feedback learning pass + change-log

Source: `planning/session-prompts/35_liv1_living_profile.md`, `planning/PRODUCT_VISION.md` §2
("Living profile" paragraph), `planning/V3A_DESIGN.md` §3 (the "How this profile learns"
change-log stub, point 4). Branch `feat/liv1-learning` off `main`, worktree
`jobify-wt/liv1-learning`. Push when done; do NOT merge.

## Global constraints (every task)

- **Ownership.** You own: `jobify/hosted/**` (new `learning.py`, edits to `fanout.py`),
  `jobify/db.py` (new read helpers + a doc-file persist helper), `web/lib/dossier/derive.ts`
  (+its test — change-log parsing ONLY), `docs/SCORING.md`, and every new/touched file's own
  test file. Do NOT touch `jobify/hunt/rubric.py` (consume `apply_feedback`/`needs_recompile`/
  `score_posting`/`compile_rubric_with_usage` as they exist), `jobify/tailor|submit`, any web
  app page or component OTHER than `web/components/onboarding/MirrorPanel.tsx` (Task 3's narrow
  exception), `web/components/dossier/ChangeLog.tsx`, `web/lib/onboarding/moduleRegistry.ts`, and
  no migrations (none needed — see the watermark design below).
- **Scrub gate:** zero operator-identifying strings anywhere (prompts, fixtures, comments). Use
  generic placeholders only.
- **No new migration.** The watermark that makes the learning pass incremental lives as a
  machine-readable HTML-comment header line INSIDE `learned-insights.md` itself:
  `<!-- last-processed: <ISO> -->` as the file's first line. A fresh profile's
  `learned-insights.md` is exactly `""` (confirmed: `web/lib/profile/buildDoc.ts`,
  `web/lib/onboarding/incrementalDoc.ts` both ship it empty) — no watermark means "process
  everything that exists so far."
- **Failure isolation.** The learning pass runs unconditionally, once per user, at the very end
  of the per-user fan-out ladder (after stage 4's matches are already written). It must NEVER
  raise out to its caller — a broken learning pass degrades to "nothing learned this cycle,"
  never to a broken scoring cycle. This is enforced by wrapping the entire pass in one
  try/except inside `jobify/hosted/learning.py::run_learning_pass` itself (not by the caller).
- **Cost rails, deliberately NOT extended.** The learning pass's full-recompile branch spends
  one real LLM call, threads `api_key` (BYO) through and writes a `budget_ledger` row exactly
  like every other LLM call in this module — but it does NOT add new global/per-user
  budget-cap gating (no `allow_new_compile`-style check). This is a deliberate scope decision
  (the session prompt specifies "one ledger row," not a new cap-gating mechanism) — do not add
  one, and do not flag its absence as a gap.
- **Small, justified cross-file renames (in-scope, both files under `jobify/hosted/**`):**
  `jobify/hosted/fanout.py`'s private `_cost_usd` -> public `cost_usd`, and private
  `_targeting_text` -> public `targeting_text` (both keep their exact bodies, only the leading
  underscore drops). `jobify/hosted/learning.py` needs both formulas verbatim (cost-ledger
  arithmetic and the targeting-tier renderer) — duplicating either risks silent drift between
  the two modules' `budget_ledger` accounting, so re-export rather than copy. Update both
  call sites inside `fanout.py` to the new names. No other renames.
- **Import-cycle discipline.** `jobify/hosted/learning.py` imports several names FROM
  `jobify.hosted.fanout` at its own top level (safe: `learning` is never imported until
  `fanout.py`'s `_run_user_ladder` calls it, by which point `fanout` is already fully loaded).
  The reverse edge — `fanout.py` needing `learning.run_learning_pass` — MUST be a lazy,
  function-local import (`from jobify.hosted import learning` inside `_run_user_ladder`, right
  before the call, with a `# noqa: PLC0415` comment matching the lazy-import convention already
  used in `jobify/profile_loader.py::_fetch_profile_row`). A module-level
  `from jobify.hosted import learning` at the top of `fanout.py` would create a real circular
  import — do not add one.
- **Test conventions:** Python tests monkeypatch `jobify.db` functions directly (see
  `tests/test_hosted_fanout.py`'s own docstring and fixtures) — no live Supabase, no
  `patch_db_client` fixture needed for `jobify/hosted/learning.py`'s own tests. `tests/test_db_hosted.py`
  uses a shared `_FakeQuery`/`_FakeClient` + `patch_db_client` fixture (`tests/conftest.py`) for
  `jobify/db.py`'s own unit tests; `_FakeQuery` currently supports `select`/`insert`/`update`/
  `upsert`/`eq`/`gte`/`execute` but NOT `.in_()` — add an `.in_()` method (filter rows whose
  column value is `in` the given list, mirroring `.eq()`'s filter-and-return-self shape) since
  two of this session's new `db.py` functions need it. Web tests: vitest, colocated
  `*.test.ts(x)`, this repo's config runs in plain `node` (no jsdom) — every existing
  onboarding-panel test proves components render fine as pure functions of props/reducers
  without a DOM.

---

## Task 1 — `jobify/hosted/learning.py`: the incremental learning pass

### 1a. `jobify/db.py` additions

Four new functions, same style/section as the existing H4 additions (`get_compiled_rubric`/
`set_compiled_rubric`/`upsert_match`/`get_unmatched_postings` — read that whole block first,
lines ~567-645). Add these directly after `get_unmatched_postings`:

```python
def get_posting_reactions(user_id: str) -> list[dict]:
    """Every `posting_reactions` row for `user_id`: `{user_id, posting_id,
    reaction, note, created_at}`. No history — the table's PK is
    `(user_id, posting_id)`, so an upsert overwrites on a changed mind;
    at most one row per posting ever."""
    return (
        _get_client().table("posting_reactions")
        .select("*")
        .eq("user_id", user_id)
        .execute()
        .data or []
    )


def get_matches_by_states(user_id: str, states: list[str]) -> list[dict]:
    """Every `matches` row for `user_id` whose `state` is one of `states`
    (e.g. `["saved", "dismissed", "applied"]`) — full rows, including
    `state_changed_at`; caller filters by timestamp (client-side, same
    style as `get_unmatched_postings`)."""
    return (
        _get_client().table("matches")
        .select("*")
        .eq("user_id", user_id)
        .in_("state", states)
        .execute()
        .data or []
    )


def get_postings_by_ids(posting_ids: list[str]) -> list[dict]:
    """Every `postings` row whose `id` is in `posting_ids` — batch lookup
    for re-scoring a set of feedback-flagged postings. Empty list in,
    empty list out, no query."""
    if not posting_ids:
        return []
    return (
        _get_client().table("postings")
        .select("*")
        .in_("id", posting_ids)
        .execute()
        .data or []
    )


def update_profile_doc_file(user_id: str, filename: str, content: str) -> None:
    """Read-modify-write exactly one key of `profiles.doc` JSONB (e.g.
    `'learned-insights.md'`) without disturbing any other doc key — same
    get-then-put shape as `get_compiled_rubric`/`set_compiled_rubric`.
    No-ops (logs nothing, raises nothing) if the profiles row or its
    `doc` column is missing/malformed — callers only reach this after
    already confirming a compiled rubric exists for this user, so a
    missing row here would be a deeper, separate bug this function isn't
    responsible for surfacing."""
    rows = (
        _get_client().table("profiles").select("doc").eq("user_id", user_id).execute().data or []
    )
    if not rows:
        return
    doc = rows[0].get("doc")
    if not isinstance(doc, dict):
        return
    _get_client().table("profiles").update(
        {"doc": {**doc, filename: content}}
    ).eq("user_id", user_id).execute()
```

**Tests** — extend `tests/test_db_hosted.py`. First add `.in_()` to `_FakeQuery`:
```python
def in_(self, col, vals):
    self._rows = [r for r in self._rows if r.get(col) in vals]
    return self
```
Then, mirroring the existing `get_posting_embedding`/`get_profile_embedding` test pairs:
- `get_posting_reactions` returns every row for the user (fake with 2+ users' rows, assert only
  the target user's rows come back).
- `get_matches_by_states` filters by state (fake with `new`/`seen`/`saved`/`dismissed` rows,
  request `["saved", "dismissed"]`, assert exactly those two come back).
- `get_postings_by_ids` returns matching rows; empty `posting_ids` returns `[]` with no query
  issued (assert `fake.queries` stays empty, or has no `postings` table entry).
- `update_profile_doc_file` writes `{**doc, filename: content}` (assert the update payload
  contains the ORIGINAL doc's other keys untouched plus the new value); no-ops cleanly when the
  profiles row doesn't exist (assert `.update()` never called) and when `doc` isn't a dict.

### 1b. `jobify/hosted/fanout.py` — two renames + the learning-pass call site

1. Rename `_cost_usd` (function def + both call sites in `_ensure_rubric`/`_stage4_verdict`) to
   `cost_usd`. Identical body, identical signature.
2. Rename `_targeting_text` (function def + its one call site in `_ensure_rubric`) to
   `targeting_text`. Identical body, identical signature.
3. In `_run_user_ladder`, right before the final `counters["users_processed"] += 1` line, add:
   ```python
   from jobify.hosted import learning  # noqa: PLC0415 — lazy, avoids a fanout<->learning import cycle
   learning.run_learning_pass(user_id, profile_dir, api_key=byo_key, counters=counters)

   counters["users_processed"] += 1
   ```
   (`byo_key` and `profile_dir` are both already in scope earlier in this same function —
   `byo_key = _resolve_byo_key(user_id)`, `profile_dir = materialize_profile_dir(user_id)`.)
   This placement means: a user skipped for `validation_status='invalid'` (the function's early
   `return` before `profile_dir` even exists) never runs the learning pass either — correct,
   consistent with "don't learn against a broken profile."

**Tests:** run the full existing `tests/test_hosted_fanout.py` suite unmodified after this
change and confirm it stays green — every existing test monkeypatches specific `db.*` functions
directly (per that file's own docstring) and none of them fake the four new `db.py` functions
above, so `learning.run_learning_pass` will hit the real (unpatched) `_get_client()` inside those
tests and raise — which its own internal try/except swallows silently, so no existing assertion
about `matches`/`counters` is affected. Add ONE new small test,
`test_run_user_ladder_calls_learning_pass_after_scoring`, that monkeypatches
`jobify.hosted.learning.run_learning_pass` with a spy and asserts it's called exactly once with
`(user_id, profile_dir)` positionally and `byo_key`/`counters` as kwargs, AFTER
`db.upsert_match` has already been called for the cycle's postings (assert call-order, not just
call-count, e.g. via a shared list both fakes append to).

### 1c. `jobify/hosted/learning.py` (new file) — the pass itself

```python
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
```

**Tests** — new file `tests/test_hosted_learning.py`, mirroring `tests/test_hosted_fanout.py`'s
fixture style (monkeypatch `db.*` functions directly, no live Supabase; use `tmp_path` for
`profile_dir`, matching `test_hosted_fanout.py::_profile_dir`'s helper — write a
`learned-insights.md` file into it directly per test rather than adding a new fixture builder
param). Cover, at minimum:

1. **No compiled rubric -> early return.** `db.get_compiled_rubric` returns `None`; assert
   `db.get_posting_reactions`/`get_matches_by_states` are never called (spy or raise-if-called).
2. **Watermark incrementality.** Seed `learned-insights.md` with an existing
   `<!-- last-processed: ... -->` line; seed reactions/matches with rows both before and after
   that timestamp; assert only the after-rows become events (check via a spy on
   `rubric_module.score_posting` call count, or via `apply_feedback`'s effect on the persisted
   rubric).
3. **No watermark (fresh file) processes everything.** Empty `learned-insights.md`; every
   existing row becomes an event.
4. **Matched-groups recovery.** A real small rubric + posting (same style as
   `test_hosted_fanout.py::_rubric`/`_posting`) where the posting's title/description contains
   one group's term; assert the event passed to (a spied) `apply_feedback` has that group's name
   in `matched_groups` and none of the non-matching groups.
5. **Reweight persisted.** Below the recompile threshold: assert `db.set_compiled_rubric` is
   called once with a rubric whose weights reflect `apply_feedback`'s multiplier (not a fake —
   let the real `apply_feedback` run against a small real rubric).
6. **Recompile fires at threshold with exactly one ledger row.** >=20 events (or a >60% dismiss
   ratio with fewer): assert `rubric_module.compile_rubric_with_usage` (monkeypatched, canned
   return) is called exactly once, `db.insert_budget_ledger_row` is called exactly once with
   `event="rubric_recompile"`, and the incremental `apply_feedback` path is NOT also taken
   (`db.set_compiled_rubric`'s single call reflects the recompiled data, not a reweighted one).
7. **Append-only insights + >5%-delta reporting.** A first pass with a group crossing the
   threshold produces one line; assert the FULL prior file content (including that line,
   verbatim) is still present, unmodified, after a second pass with a fresh batch of events
   appends a second line — write an explicit byte-level assertion that the first line's text
   is a substring of the final content.
8. **Sub-threshold reweight still persists, no insight line.** A single event whose weight
   nudge stays under 5%: assert `set_compiled_rubric` still called (the reweight always
   happens) but the file's new content adds no new dated bullet line (compare the file's bullet
   lines before/after — only the watermark line changes).
9. **Failure isolation.** Monkeypatch `db.get_posting_reactions` (or any inner step) to raise;
   assert `run_learning_pass` returns normally (no exception propagates) and that
   `db.set_compiled_rubric`/`update_profile_doc_file` are never called.
10. **Action mapping.** A direct test of `_event_action` (or its observable effect): `reaction=
    interested` -> `"save"`, `not_interested` -> `"dismiss"`; `state=saved`/`applied` -> `"save"`,
    `dismissed` -> `"dismiss"`.

---

## Task 2 — `web/lib/dossier/derive.ts`: the dossier change-log

Read the file's existing `deriveEvents`/`ChangeLogEvent` (lines ~133-137, ~431-442) and
`ChangeLog.tsx` (do NOT edit `ChangeLog.tsx` — it's frozen this session; confirm your change
doesn't require touching it) before writing anything. `ChangeLog.tsx` renders `events` generically
and keys each row with `key={event.moduleKey}` — this constrains how new non-module rows must be
shaped (see below).

**1. Widen `ChangeLogEvent.moduleKey`'s type** (still in `derive.ts` — do not touch
`moduleRegistry.ts`'s `ModuleKey` union, which stays exactly as-is):
```ts
export interface ChangeLogEvent {
  label: string;
  moduleKey: ModuleKey | `learning-${number}`;
  completedAt: string;
}
```
This is a template-literal type, valid TS, and satisfies `ChangeLog.tsx`'s `key={event.moduleKey}`
(React's `key` prop accepts any string) without editing that file. Each insight-derived row gets a
UNIQUE `learning-${index}` tag (see below) so two insight rows never collide as React keys — a
real risk if reusing a single constant string, since a fan-out cycle could run more than once on
the same calendar day, producing 2+ dated lines sharing the same date.

**2. New pure parser:**
```ts
const INSIGHT_LINE_RE = /^- (\d{4}-\d{2}-\d{2}): (.+)$/;

function deriveInsightEvents(learnedInsightsMd: string): ChangeLogEvent[] {
  return learnedInsightsMd
    .split("\n")
    .map((line) => INSIGHT_LINE_RE.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m, i) => ({
      label: `${formatMonthDay(`${m[1]}T00:00:00.000Z`)} — ${m[2]}`,
      moduleKey: `learning-${i}` as const,
      completedAt: `${m[1]}T00:00:00.000Z`,
    }));
}
```
Notes for the implementer: the regex naturally skips the `<!-- last-processed: ... -->` watermark
line (doesn't match the `- YYYY-MM-DD: ` prefix) — no special-casing needed. `completedAt` is
normalized to midnight UTC on that date (the file only ever records a date, not a time) — this is
a deliberate, simple choice: an insight logged the same calendar day as a module completion sorts
BEFORE that completion in the merged, ascending-sorted list. `label` reuses the existing
`formatMonthDay` helper (already in this file) so insight rows read in the same "Mon Day — text"
visual style as module rows (e.g. `Jul 16 — downweighted "agency work" after 3 dismissals;
upweighted "platform ownership" after 2 saves`) — do NOT re-derive or reformat the text after the
`: ` (that's Python's job; this parser is pure text-through, per the ownership note "change-log
parsing ONLY").

**3. Merge into `deriveEvents`** — change its signature to also take the raw
`learned-insights.md` string, and union+sort both sources:
```ts
function deriveEvents(modules: ModulesState, learnedInsightsMd: string): ChangeLogEvent[] {
  const moduleEvents = MODULE_ORDER.filter((key) => modules[key]).map((key) => {
    const completion = modules[key]!;
    return {
      label: `${formatMonthDay(completion.completed_at)} — ${moduleLabel(key)} · ${completion.receipt}`,
      moduleKey: key,
      completedAt: completion.completed_at,
    };
  });
  return [...moduleEvents, ...deriveInsightEvents(learnedInsightsMd)].sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt)
  );
}
```
(This is the existing `.map()` body, unchanged, just no longer inline-returned — keep it
byte-identical to today's version aside from being merged with the new source and taking the new
param.)

**4. Update the one call site** inside `deriveDossier`:
```ts
events: deriveEvents(modules, doc["learned-insights.md"] ?? ""),
```
No change to `DerivedDossierInput` needed — `doc` already carries `"learned-insights.md"` as one
of its keys.

**Tests** — extend `web/lib/dossier/derive.test.ts` (it already sets
`"learned-insights.md": ""` in its fixture doc, per the existing empty-state test — read that
test first). Add:
- Parsing: a `doc["learned-insights.md"]` containing a watermark line + 2 dated bullet lines ->
  `dossier.events` includes both, each `label` in the `"Mon Day — <text>"` shape, `moduleKey`
  values `"learning-0"`/`"learning-1"` (unique), watermark line produces NO event.
- Empty state preserved: `"learned-insights.md": ""` (today's existing fixture) still yields
  zero insight events — combined with zero completed modules, `dossier.events` stays `[]` exactly
  as the existing "phase-1-only" test already asserts (do not weaken that assertion).
- Interleaving: a profile with 2+ completed modules AND 2+ insight lines whose dates fall before/
  between/after the modules' `completed_at` timestamps -> `dossier.events` is sorted strictly by
  `completedAt` ascending, mixing both kinds of rows in the correct chronological order (assert
  the exact resulting order of `moduleKey` values, mixing real `ModuleKey`s and `"learning-N"`
  tags).

---

## Task 3 — Mirror/Metrics retry-affordance parity (parked polish)

Read `web/components/onboarding/MetricsPanel.tsx` in full (already has this pattern — the
`extract_retried` action + `reloadToken` counter + the error-phase Retry button, lines ~28,
39-40, 225-238, 261-269) and `web/components/onboarding/MirrorPanel.tsx` in full (currently has
NO retry: the mount-`useEffect`'s dependency array is `[]`, `MirrorAction` has no retry variant,
and the `phase === "error"` branch renders only a bare `<p>`, no button). This is the exact gap —
MetricsPanel's first-extraction failure is recoverable in-panel; MirrorPanel's first-generation
failure is a dead end (only a page reload recovers it) today.

**Changes to `MirrorPanel.tsx` only:**

1. Add a `reloadToken: number` field to `MirrorState`, initialized to `0` in `initialMirrorState`.
2. Add a new `MirrorAction` variant: `{ type: "generate_retried" }`.
3. Add its reducer case, mirroring `metricsReducer`'s `"extract_retried"` exactly:
   ```ts
   case "generate_retried":
     return { ...state, phase: "generating", error: null, reloadToken: state.reloadToken + 1 };
   ```
4. Change the mount `useEffect`'s dependency array from `[]` to `[state.reloadToken]` (this is
   the ONLY behavioral change needed to make the effect re-fire on retry — `generateMirror` is
   already called unconditionally inside it).
5. In the `phase === "error"` render branch, replace the bare `<p>` with the same
   button-alongside-message shape `MetricsPanel` uses:
   ```tsx
   if (state.phase === "error") {
     return (
       <div className="flex flex-col items-start gap-3">
         <p className="text-sm text-danger">{state.error}</p>
         <Button variant="secondary" onClick={() => dispatch({ type: "generate_retried" })}>
           Retry
         </Button>
       </div>
     );
   }
   ```

Do not touch anything else in this file (the `regenerate_*` actions, `MirrorReflectionView`,
`highlightQuotedPhrases`, etc. are unrelated to this gap and already work). Do not touch
`MetricsPanel.tsx` itself — it's already the reference implementation, not part of the diff.

**Tests** — extend `web/components/onboarding/MirrorPanel.test.tsx` (it currently has zero
coverage of the `phase === "error"` branch — confirm this before writing, per the research: no
existing test imports/exercises it). Add, mirroring `MetricsPanel.test.tsx`'s
`"extract_retried resets back to extracting and bumps the reload token"` test (lines ~45-50)
exactly in shape:
```ts
it("generate_retried resets back to generating and bumps the reload token", () => {
  const errored = mirrorReducer(initialMirrorState(), { type: "generate_failed", error: "x" });
  const retried = mirrorReducer(errored, { type: "generate_retried" });
  expect(retried.phase).toBe("generating");
  expect(retried.reloadToken).toBe(1);
});
```
Also add a render-level test (same `fetchImpl` mock pattern the file already uses elsewhere) that
mounts `MirrorPanel`, forces the first `generateMirror` call to reject, asserts the error message
AND a "Retry" button both render, clicks Retry, and asserts `generateMirror` (i.e. the underlying
`fetchImpl`) is called a second time.

---

## Task 4 — `docs/SCORING.md`: the "Learning loop" section

Read the existing `### Feedback and recompiling` subsection (inside `## Stage 2 — the compiled
rubric`, ~lines 120-138) first — it already documents `apply_feedback`/`needs_recompile`'s
contract precisely and ends with "the wiring is H4/H6's job, not this module's," which is now
stale (this session IS that wiring). Two edits:

1. In that existing subsection, replace the final sentence — "`needs_recompile(events)` — the
   yes/no heuristic a nightly job (wiring is H4/H6's job, not this module's) uses to decide..." —
   with "...a nightly job uses to decide..." (drop the now-stale "wiring is H4/H6's job, not this
   module's" parenthetical) and add one trailing sentence: "See '## Learning loop' below for the
   actual wiring."
2. Add a new top-level section, positioned AFTER `## Stage 3 — embedding rerank` and BEFORE
   `## Profile source: directory or DB row` (a cross-cutting concern, not a numbered ladder
   stage — matching where `## Profile source...` itself already sits):

```markdown
## Learning loop

`jobify/hosted/learning.py::run_learning_pass(user_id, profile_dir, *, api_key=None,
counters=None)` runs once per user at the end of `jobify/hosted/fanout.py::_run_user_ladder`,
after stage 4 — the piece `rubric.py`'s own module docstring flagged as "scheduled elsewhere"
(see Stage 2's "Feedback and recompiling" above). Zero LLM calls except the rare full-recompile
branch.

**Watermark.** `learned-insights.md` opens with an HTML-comment header line,
`<!-- last-processed: <ISO> -->`, so each pass only looks at `posting_reactions` / `matches`
rows newer than the last run — no new migration/column needed. A fresh profile's file has no
watermark, so the first-ever pass processes every existing row.

**Events.** For every `posting_reactions` row and every `matches` row in `{saved, dismissed,
applied}` state, changed since the watermark, the pass re-runs `rubric.score_posting(current_rubric,
posting)` — the group-match breakdown was never persisted at score time, only the final score —
to recover `matched_groups`, then maps `reaction=interested` / `state=saved` -> `action="save"`;
`reaction=not_interested` / `state=dismissed` -> `action="dismiss"`; `state=applied` ->
`action="save"` (a stronger positive signal than a save; `apply_feedback` has no separate
multiplier for it).

**Reweight vs. recompile.** `needs_recompile(events)` picks exactly one branch, never both:
below threshold, `apply_feedback(rubric, events)` nudges weights and the result is persisted via
`db.set_compiled_rubric`; at/above threshold, a fresh `compile_rubric_with_usage` call replaces
the rubric wholesale (one `budget_ledger` row, `event="rubric_recompile"`, mirroring
`_ensure_rubric`'s own cost-tracking pattern).

**Insights.** After a reweight, any term-group whose weight moved more than 5% gets a dated,
human-readable line appended to `learned-insights.md` (append-only — prior entries are never
rewritten), e.g. `- 2026-07-16: downweighted "agency work" after 3 dismissals; upweighted
"platform ownership" after 2 saves`. A recompile gets its own line instead (`- 2026-07-16: rubric
recompiled from scratch after 24 feedback events`) — group names aren't guaranteed stable across
a full recompile, so no per-group delta is attempted on that branch. The dossier's change-log
(`web/lib/dossier/derive.ts::deriveEvents`) parses these same dated lines back out, interleaved
chronologically with module-completion rows.

**Failure isolation.** `run_learning_pass` catches every exception internally and logs — a broken
learning pass degrades to "no learning happened this cycle," never to a broken scoring cycle.
```

No tests for this task (docs only) — just confirm the prose matches what Task 1 actually shipped
(function names, event name, threshold value) before finalizing; adjust wording only if the real
implementation differs in some minor way from this draft, never the reverse.

---

## Exit criteria (verify after all tasks, before the final review)

- `python -m pytest` (repo root) — full suite green, including the new
  `tests/test_hosted_learning.py`, extended `tests/test_db_hosted.py`, and the full
  `tests/test_hosted_fanout.py` (unmodified assertions still pass with the new call site wired
  in).
- `cd web && npx vitest run` — full suite green, including extended `derive.test.ts` and
  `MirrorPanel.test.tsx`.
- `cd web && npx tsc --noEmit` — green.
- `cd web && npm run build` — green.
- Scrub gate: grep the diff for any literal operator-identifying string (name, personal email,
  specific employer) — should find none.
- `git diff --stat` against `main` shows changes only inside this session's ownership:
  `jobify/db.py`, `jobify/hosted/fanout.py`, `jobify/hosted/learning.py` (new),
  `tests/test_db_hosted.py`, `tests/test_hosted_fanout.py`, `tests/test_hosted_learning.py` (new),
  `web/lib/dossier/derive.ts`, `web/lib/dossier/derive.test.ts`,
  `web/components/onboarding/MirrorPanel.tsx`, `web/components/onboarding/MirrorPanel.test.tsx`,
  `docs/SCORING.md`.

Commit message: `LIV-1: living profile — feedback learning pass, insight entries, dossier
change-log, mirror retry polish`. Push `feat/liv1-learning`. Do NOT merge.
