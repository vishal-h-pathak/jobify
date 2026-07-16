# Task 4 — SCORING.md Learning loop section — DONE

## Summary

Completed two documentation edits to `docs/SCORING.md`:

1. **Removed stale parenthetical** in the "Feedback and recompiling" subsection (line 134-138): Dropped the now-obsolete "(wiring is H4/H6's job, not this module's)" since this session's `learning.py` IS that wiring, and added cross-reference: "See '## Learning loop' below for the actual wiring."

2. **Added new top-level "## Learning loop" section** (positioned after "## Stage 3 — embedding rerank" and before "## Profile source: directory or DB row"), documenting:
   - Function entry point: `run_learning_pass(user_id, profile_dir, *, api_key=None, counters=None)`
   - Call site: end of `_run_user_ladder` after stage 4
   - Watermark format: HTML comment `<!-- last-processed: <ISO> -->` (verified against `_WATERMARK_RE`)
   - Event mapping logic (posting_reactions / matches state transitions → feedback actions)
   - Reweight vs. recompile branching logic (threshold check → `apply_feedback` or `compile_rubric_with_usage`)
   - Insight-generation rules (5% delta threshold via `INSIGHT_DELTA_THRESHOLD`, dated append-only entries)
   - Failure isolation pattern (exception catching, never breaks scoring cycle)

## Verification against implementation

All prose in the new section was verified against actual code in `jobify/hosted/learning.py` and `jobify/hosted/fanout.py`:

| Item | Brief | Code | Match |
|------|-------|------|-------|
| Function signature | `run_learning_pass(user_id, profile_dir, *, api_key=None, counters=None)` | Line 173-176 | ✓ |
| Event name | `event="rubric_recompile"` | `RUBRIC_RECOMPILE_EVENT = "rubric_recompile"` (line 45) | ✓ |
| Insight delta threshold | 5% | `INSIGHT_DELTA_THRESHOLD = 0.05` (line 55) | ✓ |
| Watermark regex | `<!-- last-processed: <ISO> -->` | `_WATERMARK_RE = re.compile(r"^<!-- last-processed: (?P<iso>\S+) -->\n?")` (line 57) | ✓ |
| Call site | End of `_run_user_ladder` after stage 4 | Line 681 in fanout.py, inside `_run_user_ladder` | ✓ |
| Feedback match states | `{saved, dismissed, applied}` | `FEEDBACK_MATCH_STATES = ("saved", "dismissed", "applied")` (line 49) | ✓ |
| Reweight vs. recompile | Checks `needs_recompile`, branches to `apply_feedback` or `compile_rubric_with_usage` | Lines 201-228 | ✓ |

No adjustments to the brief's draft prose were needed — implementation exactly matches the specification provided.

## Files changed

- `docs/SCORING.md` (+44 lines, -5 lines): two edits as described above

## Concerns

None. The documentation is complete and verified.
