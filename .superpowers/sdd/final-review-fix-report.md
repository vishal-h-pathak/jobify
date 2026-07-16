# Final-review polish fix — LIV-1 learning pass

Scope: `jobify/hosted/learning.py` (+ one new test in
`tests/test_hosted_learning.py`) only, per the final whole-branch review's
"silent-permanent-stall class" finding.

## The finding

Because the watermark only advances via a successful file write at the end
of `_run_learning_pass_inner`, any raise before that point (`score_posting`
on a malformed posting, or a mis-parsed empty watermark) would re-fetch and
re-fail the identical rows every cycle forever — degrading the learning
feature silently (only `logger.error`), though never the scoring cycle
itself (the try/except in `run_learning_pass` already guarantees that).

## Changes

1. **`_collect_events`: per-posting scoring is now failure-isolated.**
   The event list is no longer built with a bare list comprehension calling
   `_matched_groups(rubric, postings_by_id[pid])` unconditionally. It's now
   a `for` loop that wraps that one call in try/except: if
   `rubric_module.score_posting` (via `_matched_groups`) raises on a
   malformed posting, that single event still gets appended (with
   `matched_groups: []` — the same fallback shape already used for
   "posting not found"), a `logger.warning` names the `posting_id`, and the
   rest of the batch is unaffected. The "posting not found" branch
   (`pid not in postings_by_id`) is unchanged.

2. **`_run_learning_pass_inner`: guard against persisting a blank
   watermark.** Immediately after `events, new_watermark =
   _collect_events(...)`, before the existing `if not events: return`,
   added: if `events` is non-empty but `new_watermark` is falsy/blank, log
   a `logger.warning` and return without writing `learned-insights.md` or
   calling `db.update_profile_doc_file`. This prevents ever persisting a
   watermark that `_WATERMARK_RE` couldn't re-parse next pass (which would
   otherwise re-fetch and re-fail the same rows forever). Verified this
   branch is effectively unreachable today — `_collect_events` only
   returns `new_watermark = ""` when `candidates` is empty, and that path
   already returns `events = []`, which the pre-existing check catches
   first — so this is cheap defensive insurance, not a change to any
   normal-path behavior.

3. **Docstring note on `_collect_events`.** Documented that the watermark
   comparison (`ts <= watermark_iso`) is a lexical string comparison, not a
   parsed-datetime comparison, and therefore assumes
   `posting_reactions.created_at` / `matches.state_changed_at` are
   homogeneously-serialized ISO-8601 timestamps from PostgREST.

## Test added

`tests/test_hosted_learning.py::test_scoring_failure_on_one_posting_does_not_drop_the_batch`
— monkeypatches `rubric_module.score_posting` to raise for one posting
(`p-bad`) while a second (`p-good`) scores normally, and asserts:
- both events survive into the batch handed to `apply_feedback` (2, not 1)
- the failing posting's event has `matched_groups == []`
- the other posting's event is scored normally (`matched_groups == ["core"]`)
- the failing posting's id appears in the warning log

## Test run

```
.venv/bin/python -m pytest tests/test_hosted_learning.py -v
```

```
collected 11 items

tests/test_hosted_learning.py::test_no_compiled_rubric_short_circuits PASSED
tests/test_hosted_learning.py::test_watermark_incrementality_only_processes_newer_rows PASSED
tests/test_hosted_learning.py::test_no_watermark_processes_every_existing_row PASSED
tests/test_hosted_learning.py::test_matched_groups_recovers_only_the_hit_group PASSED
tests/test_hosted_learning.py::test_scoring_failure_on_one_posting_does_not_drop_the_batch PASSED
tests/test_hosted_learning.py::test_reweight_persisted_reflects_apply_feedback_multiplier PASSED
tests/test_hosted_learning.py::test_recompile_fires_at_event_threshold PASSED
tests/test_hosted_learning.py::test_insights_are_append_only_across_two_passes PASSED
tests/test_hosted_learning.py::test_sub_threshold_reweight_persists_without_insight_line PASSED
tests/test_hosted_learning.py::test_failure_in_inner_step_never_propagates PASSED
tests/test_hosted_learning.py::test_event_action_mapping PASSED

11 passed in 1.31s
```

All prior tests remain green — no regressions. (The worktree's `.venv` was
missing `pytest`/`python-dotenv`/other project deps; ran
`uv pip install --python .venv/bin/python -e ".[dev]"` to populate it —
tooling only, no project files touched.)

## Not touched

No other files in `jobify/hosted/` or elsewhere were modified. The prior
content of this report file (from an earlier, unrelated `feat/hosted-h4-worker`
review-fix pass) has been replaced with this one, per this task's
instructions to write the report to this exact path.
