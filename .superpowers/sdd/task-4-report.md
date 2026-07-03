# Task 4 report — Entry point + schedule + final verification (H4)

## What I implemented

### Part A — `jobify-hosted-hunt` console script

- New module `jobify/hosted/worker.py`:
  - `_execute() -> dict` — runs one hosted-worker cycle: calls
    `jobify.hosted.discovery.run_discovery_cycle()`, then
    `jobify.hosted.fanout.run_fanout_cycle()`, logs both summaries, prints
    a combined one-line summary (`_summary_line`), and returns
    `{"discovery": ..., "fanout": ...}`.
  - `run() -> None` — the console-script target. `argparse` with a
    documented no-op `--once` flag (mirrors `jobify-hunt`'s own no-op
    flag), then calls `_execute()`. Single-shot, no internal loop —
    matches `jobify.hunt.agent.run()`'s pattern exactly.
  - **Failure-isolation policy (documented in the module docstring and
    `_execute()`'s docstring):** `run_discovery_cycle()` is NOT wrapped in
    a try/except in this module. A whole-phase discovery failure
    propagates and aborts the cycle before fan-out runs. Rationale: I
    read `jobify.hunt.agent`'s error-handling posture — `iter_all_jobs()`
    isolates failures **per source** (a try/except inside the loop over
    `SOURCES`), but `_execute()` itself has no top-level try/except
    around the sweep as a whole; anything that survives the per-item
    guards is allowed to propagate and crash the run. I applied the same
    philosophy one level up, at the phase boundary, for this task:
    discovery's own per-source resilience (Task 2) and fan-out's own
    per-user resilience (Task 3) already isolate failures *within* each
    phase. A failure at the *whole-phase* level here (not one item inside
    it) is treated the same way `jobify.hunt.agent` treats a whole-phase
    failure — it propagates rather than being silently swallowed. Running
    fan-out against a stale/partial `postings` pool left by a crashed
    discovery phase would silently score users against incomplete data
    with no signal anything went wrong; aborting loudly (non-zero exit,
    visible in cron/GHA logs) was the safer, more consistent choice.
- `pyproject.toml`: added
  `jobify-hosted-hunt = "jobify.hosted.worker:run"` under
  `[project.scripts]`, with a comment explaining the composition.
  Reinstalled the package (`uv pip install -e . --python .venv/bin/python`
  — `pip` itself isn't on this venv's PATH, `uv` resolved from its local
  cache with no network) and confirmed
  `jobify.egg-info/entry_points.txt` now lists `jobify-hosted-hunt`, and
  `.venv/bin/jobify-hosted-hunt --help` runs and prints the expected
  usage.

### Part B — `.github/workflows/hosted-hunt.yml`

Modeled on `.github/workflows/hunt.yml`, deliberately simplified per the
brief (no dashboard-run-row integration — no `scripts/mark_run.py`, no
`run_id` input):

- `workflow_dispatch` trigger (no inputs needed — no `mode`, since the
  hosted worker takes none).
- `schedule:` block present but commented out, exactly like `hunt.yml`'s
  disabled-by-default posture.
- Steps: checkout, setup-python (3.11), setup-node (20), install Claude
  Code CLI (OAuth fallback — same reason `hunt.yml` documents:
  `jobify.shared.llm` falls back to the Agent SDK under
  `CLAUDE_CODE_OAUTH_TOKEN`, which is what both fan-out's rubric-compile
  and stage-4 verdict calls route through), `pip install -e .`, then run
  `jobify-hosted-hunt --once`.
- Env vars, read straight from `jobify/config.py` per the brief rather
  than guessed: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `VOYAGE_API_KEY`. Also
  included `SERPAPI_KEY` / `JSEARCH_API_KEY` — per the brief's explicit
  instruction, Task 2 wired all nine `jobify.hunt.sources` fetchers
  (including the two paid keyword-search sources) into hosted discovery,
  so this workflow needs those secrets too; I confirmed this by reading
  `jobify/hosted/discovery.py`'s `_FIXED_SOURCES` tuple, which includes
  `jsearch` and `serpapi`.
- Did not carry over `hunt.yml`'s `tee ... | PIPESTATUS` /
  `mark_run.py` plumbing — nothing in this workflow consumes an exit-code
  output, so I ran `jobify-hosted-hunt --once` directly; GHA's own step
  log already captures stdout/stderr.
- Validated with `python -c "import yaml; yaml.safe_load(...)"` — parses
  cleanly.

### Part C — final verification (see walkthrough below)

## What I tested

New file `tests/test_hosted_worker.py`, three tests (fakes both
`run_discovery_cycle`/`run_fanout_cycle` — no real discovery/fan-out
execution, per the brief):

1. `test_execute_calls_discovery_then_fanout` — asserts call order
   (`["discovery", "fanout"]`), asserts `_execute()`'s return value
   matches both fakes' summaries, and asserts the printed summary line
   contains fields drawn directly from each cycle's own return-dict
   names (`fetched=`, `upserted=`, `dead=`, `processed=`,
   `matches_written=`, `stage4_calls=`, `budget_stopped=`).
2. `test_execute_aborts_cycle_when_discovery_raises` — discovery fake
   raises `RuntimeError`; asserts the exception propagates out of
   `_execute()` (`pytest.raises`) and that the fan-out fake was never
   called — verifying the documented failure-isolation policy.
3. `test_run_parses_once_flag_and_executes_one_cycle` — monkeypatches
   `sys.argv` to `["jobify-hosted-hunt", "--once"]` and `worker._execute`,
   confirms `run()` parses cleanly and calls `_execute()` exactly once.

### Test results

```
$ python -m pytest tests/test_hosted_worker.py -q
...
3 passed in 0.18s

$ python -m pytest -q          # full suite
........................................................................ [ 12%]
........................................................................ [ 24%]
........................................................................ [ 36%]
........................................................................ [ 49%]
........................................................................ [ 61%]
........................................................................ [ 73%]
........................................................................ [ 85%]
........................................................................ [ 98%]
...........                                                              [100%]
587 passed, 1 skipped, 26 deselected in 24.87s

$ ruff check jobify/hosted/
All checks passed!
```

No network calls anywhere (discovery/fan-out are fully faked in this
task's own tests; the rest of the suite was already network-free before
this task).

## Part C exit-criteria walkthrough

1. **Full suite green, no network.**
   `python -m pytest -q` → `587 passed, 1 skipped, 26 deselected` — clean.
   The 1 skip and 26 deselected are pre-existing (the `legacy` marker
   exclusion and one environment-gated skip elsewhere in the suite; not
   introduced by this task). PASS.

2. **`jobify-hunt` (single-user path) behavior unchanged.**
   Ran every `hunt`-prefixed test file plus a `-k hunt` sweep:
   `python -m pytest tests/ -q -k "hunt"` → `68 passed, 1 skipped, 545
   deselected`. This task touched zero files under `jobify/hunt/`,
   `jobify/hosted/discovery.py`, or `jobify/hosted/fanout.py` — only added
   a new module (`jobify/hosted/worker.py`), a new workflow file, and one
   new `pyproject.toml` `[project.scripts]` line. PASS.

3. **The `lru_cache` regression test exists and passes.**
   `tests/test_profile_loader_db.py::test_fan_out_does_not_touch_global_profile_dir_cache`
   (Task 1's regression test, guarding `profile_dir()`'s
   `@lru_cache(maxsize=1)` against cross-user leakage) is present and
   green:
   `python -m pytest tests/test_profile_loader_db.py::test_fan_out_does_not_touch_global_profile_dir_cache -q`
   → `1 passed`. Not re-added — confirmed as-is. PASS.

4. **`git diff --stat main...HEAD`: no forbidden paths touched anywhere
   on the branch.**

   ```
   $ git diff --stat main...HEAD
    .github/workflows/hosted-hunt.yml |  68 ++++
    .superpowers/sdd/task-1-report.md | 329 +++++++++++++++++++
    .superpowers/sdd/task-2-report.md | 324 +++++++++++++++++++
    .superpowers/sdd/task-3-report.md | 342 ++++++++++++++++++++
    docs/SCORING.md                   |  37 +++
    jobify/config.py                  |  19 ++
    jobify/db.py                      | 313 +++++++++++++++++++
    jobify/hosted/__init__.py         |  24 ++
    jobify/hosted/discovery.py        | 243 ++++++++++++++
    jobify/hosted/embed.py            | 196 ++++++++++++
    jobify/hosted/fanout.py           | 507 ++++++++++++++++++++++++++++++
    jobify/hosted/worker.py           | 118 +++++++
    jobify/hunt/rubric.py             |  62 ++++
    jobify/hunt/sources/_portals.py   |  42 ++-
    jobify/hunt/sources/ashby.py      |  39 ++-
    jobify/hunt/sources/greenhouse.py |  39 ++-
    jobify/hunt/sources/lever.py      |  39 ++-
    jobify/hunt/sources/workday.py    |  38 ++-
    jobify/migrations/0004_worker.sql |  40 +++
    jobify/migrations/README.md       |  17 +
    jobify/profile_loader.py          | 169 +++++++---
    jobify/shared/llm.py              | 134 ++++++--
    onboarding/validate_profile.py    | 161 +++++-----
    pyproject.toml                    |  12 +
    tests/test_db_hosted.py           | 485 ++++++++++++++++++++++++++++
    tests/test_hosted_discovery.py    | 517 ++++++++++++++++++++++++++++++
    tests/test_hosted_embed.py        | 232 ++++++++++++++
    tests/test_hosted_fanout.py       | 643 ++++++++++++++++++++++++++++++++++++++
    tests/test_hosted_worker.py       | 111 +++++++
    tests/test_hunt_rubric.py         |  70 +++++
    tests/test_onboarding_example.py  |  32 ++
    tests/test_portals_fanout.py      | 125 ++++++++
    tests/test_profile_loader_db.py   | 125 +++++++-
    tests/test_shared_llm.py          | 189 ++++++++++-
    34 files changed, 5641 insertions(+), 200 deletions(-)
   ```

   Confirmed with a targeted diff-stat against the specific forbidden
   paths (empty output = untouched across the whole branch):
   `git diff --stat main...HEAD -- web/ dashboard/ jobify/tailor/
   jobify/submit/ '*0002_multitenant.sql' '*0003_hosted_onboarding.sql'`
   → no output. `jobify/migrations/0004_worker.sql` was added by Task 1
   (not by this task) — it is not one of the two forbidden migration
   files (`0002_multitenant.sql` / `0003_hosted_onboarding.sql`); this
   task did not touch it. PASS.

5. **`jobify/hosted/` passes `ruff check` cleanly.**
   `ruff check jobify/hosted/` → `All checks passed!` (covers
   `__init__.py`, `discovery.py`, `embed.py`, `fanout.py`, and this
   task's new `worker.py` together). PASS.

All five exit criteria pass.

## Files changed (this task's own commit)

- `jobify/hosted/worker.py` (new) — `_execute()` / `run()` entry point.
- `pyproject.toml` — added `jobify-hosted-hunt` console script.
- `.github/workflows/hosted-hunt.yml` (new) — disabled-by-default cron +
  manual-dispatch workflow.
- `tests/test_hosted_worker.py` (new) — 3 tests (call order + summary,
  failure isolation, `run()`'s argparse wiring).

Commit: `b2f2fae` — `H4: shared discovery + per-user scoring ladder
fan-out (rubric/embed/LLM top-N) + budget stop` (exact message from the
brief). (Amended once from an initial `0a3f8ba` to fold in this report
file itself, matching the established per-task convention where
`.superpowers/sdd/task-N-report.md` ships in the same commit — see
`task-1-report.md`/`task-2-report.md`/`task-3-report.md` in prior
commits. The `.superpowers/sdd/` directory has its own nested
`.gitignore` that excludes everything by default; the report is
force-added, same as the prior three tasks' reports.)

## Self-review

- **Completeness:** console script wired and verified via a real
  `--help` invocation after an editable reinstall; workflow file created,
  disabled-by-default (`schedule:` commented out, matching `hunt.yml`);
  all 5 exit criteria walked through above with command output as
  evidence.
- **Quality:** `_execute()`/`run()`/`_summary_line()` are small,
  single-purpose, and named consistently with `jobify.hunt.agent`'s own
  `_execute()`/`run()` split. The failure-isolation rationale is
  documented in three places (module docstring, `_execute()`'s
  docstring, and the test file's docstring) so a future reader doesn't
  have to reverse-engineer the choice.
- **Discipline:** `worker.py` calls `discovery.run_discovery_cycle()` and
  `fanout.run_fanout_cycle()` exactly once each, in order — no
  reimplementation of either module's internals. No file outside this
  task's ownership (`jobify/hosted/worker.py`,
  `.github/workflows/hosted-hunt.yml`, `pyproject.toml`) was modified in
  this commit.
- **Testing:** all three new tests fail if the behavior they check
  regresses (verified by temporarily reordering the calls / removing the
  raise-propagation while drafting — reverted before finalizing). Ran
  with `-q` for pristine output; no warnings emitted.

## Issues or concerns

None. `pip` was not on the venv's PATH in this environment (only `pytest`
was pre-installed); `uv pip install -e . --python .venv/bin/python`
worked from local cache with no network access and correctly regenerated
`jobify.egg-info/entry_points.txt` to include `jobify-hosted-hunt`. Not a
concern for CI, since the workflow itself runs a fresh `pip install -e .`
in a clean GHA image where `pip` is present by default.
