# Final-review fix

Applied after the whole-branch review of `feat/hosted-h4-worker` (HEAD
`2ed2b14`) surfaced one real bug and stale docs before the branch could be
pushed.

## Important #1 — expired postings leaking into user feeds

`jobify.db.get_unmatched_postings(user_id)` now excludes
`link_status='expired'` rows from its result. `jobify.hosted.discovery`
still upserts a dead-link posting into the shared `postings` pool (for
record-keeping — see `test_run_discovery_cycle_drops_dead_but_still_counts`
in `tests/test_hosted_discovery.py`, unchanged), but that row can no
longer be scored into any user's `matches` via
`jobify.hosted.fanout._run_user_ladder`. No existing test asserted the
opposite (the two existing `get_unmatched_postings` tests in
`tests/test_db_hosted.py` never set `link_status` at all), so nothing
needed correcting — only a new regression test was added:
`test_get_unmatched_postings_excludes_expired_link_status`, covering
`expired` (excluded), `direct` / `aggregator_unverified` / missing
(all included).

## Important #2 — docs/SCORING.md staleness

Four fixes, all in `docs/SCORING.md`:

1. "Profile source" section rewritten to describe the actual gate-and-skip
   contract: `profiles.validation_status` is a hard gate the fan-out
   worker reads before running any stage (`'invalid'` skips the user
   entirely, `None` fails open), not just a logged warning.
2. New "Global discovery — no per-profile title filter" subsection
   documenting the deliberate `apply_title_filter=False` bypass (commit
   `ae2a789`) and that per-user title filtering happens downstream in
   fan-out stage 1.
3. Pipeline-stage-4 table line updated from "budget-gated hosted-side by
   H6" to describe what's actually shipped (per-cycle MTD-spend-vs-cap
   stop, H4 Task 3) while still noting full caps enforcement (mid-run
   re-checks, notifications) remains H6's job.
4. Short note added to the stage-3 section on the `.embedding_stamp`
   file-based profile-embedding staleness/recompute mechanism (commit
   `e7573f4`).

## Minor fixes (comments only, no behavior change)

- `jobify/hosted/fanout.py`: one-line comment at the stage-4 budget gate
  noting the per-cycle overshoot bound (checked once before the batch,
  not a hard mid-batch cap).
- `jobify/db.py::upsert_posting`: one-line comment noting `postings.remote`
  is never populated, so `jobify.hunt.rubric.score_posting`'s `remote is
  True` gate branch is currently dead in the hosted pipeline (pre-existing
  gap, not introduced by this branch; no source-fetcher behavior changed).

## Explicitly skipped

Minor #5 (redundant embedding re-fetch in stage 3) was left untouched per
the brief — real code change, more risk than value this late in the
branch.

## Test results

- `pytest tests/test_hosted_discovery.py tests/test_hosted_fanout.py tests/test_db_hosted.py -q` — 57 passed
- `pytest -q` (full suite) — 588 passed, 1 skipped, 26 deselected
- `ruff check` on every touched file (`jobify/db.py`, `jobify/hosted/fanout.py`, `tests/test_db_hosted.py`) — all checks passed

No new migration. No files touched outside the branch's established
ownership (`jobify/hosted/`, `jobify/db.py`, `docs/SCORING.md`, plus this
report and the one new test file's additions).
