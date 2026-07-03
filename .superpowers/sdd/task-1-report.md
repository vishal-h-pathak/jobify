# Task 1 report — Foundational infra for H4 (hosted worker)

## What I implemented

### 1. Parameterized profile loading (`jobify/profile_loader.py`)

- Renamed the DB-materialization function `_materialize_from_db(user_id)` →
  `materialize_profile_dir(user_id) -> Path` (public API per the brief).
  Kept `_materialize_from_db = materialize_profile_dir` as a module-level
  alias so `profile_dir()` and the existing DB-backend tests that call the
  old private name keep working unchanged. It does not touch
  `profile_dir()`'s `@lru_cache` and does not mutate any env var — safe to
  call once per user, in a loop, in one process.
- Every `load_*()` function (`load_thesis`, `load_profile`,
  `load_profile_text`, `load_archetypes`, `load_application_defaults`,
  `load_resume_template`, `load_cv`, `load_disqualifiers`,
  `load_disqualifiers_text`, `load_portals`, `load_article_digest`,
  `load_learned_insights`, `load_voice_profile`) now takes an optional
  `profile_dir: Optional[Path] = None` parameter. Omitting it (every
  current call site) resolves the global `profile_dir()` exactly as
  before; passing an explicit `Path` reads that directory directly,
  bypassing the global cache entirely. Implemented once in `_read_text` /
  `_read_yaml` (now both take a `dir_override` param); the zero-arg
  behavior is byte-identical.
- Fixed `jobify/hunt/sources/_portals.py`'s `_PORTALS_CACHE` the same way:
  `companies()`, `workday_tenants()`, `passes_title_filter()`,
  `title_signals()`, and the internal `_load_portals()` / `_filter_cfg()`
  all take an optional `profile_dir` positional/keyword arg. `None` (every
  existing `jobify.hunt.sources.*` call site) uses the process-global
  cache unchanged; an explicit dir reads through uncached and never reads
  from or writes to the global cache.

**Latent bug fixed along the way (in scope, not a scope-creep judgment
call I made lightly):** `onboarding/validate_profile.py::validate_profile_dir`
previously mutated `JOBIFY_PROFILE_DIR` and cleared/restored
`profile_loader`'s `lru_cache` around every validation call, so it could
never have been called twice in the same process without an implicit
serialization risk — exactly the class of process-global hazard the H4
brief calls out. Since `materialize_profile_dir` calls into this function
on every materialization, and the brief is explicit that
`materialize_profile_dir` "must NOT mutate ... any other process-global
env var," I rewrote `validate_profile_dir` to read the target directory
through the new dir-parameterized loaders directly (`profile_loader.load_profile(target)`,
etc.) instead of the env-var/lru_cache dance. Behavior is unchanged
(same checks, same `Report`); `os` import removed as it's now unused.
`tests/test_onboarding_example.py` gets a new regression test
(`test_validate_profile_dir_does_not_touch_process_globals`) pinning
this.

### 2. Validation gates scoring, not just logs

- `_validate_materialized` now writes the verdict to
  `profiles.validation_status` via a new `jobify.db.set_profile_validation_status(user_id, status)`
  helper, using the convention `'valid'` / `'invalid'` (constants
  `VALIDATION_STATUS_VALID` / `VALIDATION_STATUS_INVALID` in
  `profile_loader.py`). It still logs a WARNING on failure (operator
  signal), but the DB write — not the log line — is what a caller should
  gate on. The DB write itself is best-effort (wrapped in try/except with
  a warning) so a write hiccup never crashes materialization; the cache
  dir is already usable on disk regardless.
- Added `jobify/migrations/0004_worker.sql`: additive,
  `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS validation_status TEXT;`,
  with a header comment block matching `0002_multitenant.sql`'s style.
  Documented in `jobify/migrations/README.md` under a new "0004" section.

  **Flagging a real collision, not resolving it unilaterally:** the
  concurrent H3 session prompt (`planning/session-prompts/12_h3_onboarding_web.md`,
  task 2) also specifies a `profiles.validation_status` column — as
  `jsonb`, in its own `0003_hosted_onboarding.sql`. Both sessions
  independently arrived at the same column name for different purposes
  (H3: onboarding-time doc validation; H4: fan-out materialization
  gating) with different types. I did not rename or coordinate around
  this since it's a cross-session decision outside my task's ownership —
  flagged in both the migration file's header comment and the README so
  the controller can reconcile at merge review (rename one, fold into
  the other, or pick a single column shape).

### 3. Ledger-write helpers (`jobify/db.py`)

New "HOSTED — per-user profile validation + budget ledger (H4)" section:
- `set_profile_validation_status(user_id, status)` — writes
  `profiles.validation_status`.
- `insert_budget_ledger_row(user_id, event, *, model=None, input_tokens=0, output_tokens=0, cost_usd=0.0, run_id=None)`
  — one `budget_ledger` insert; append-only per the table's RLS design.
- `get_month_to_date_spend(user_id) -> float` — sums `budget_ledger.cost_usd`
  for the user since the start of the current UTC calendar month
  (filters server-side by `created_at >=` the computed UTC month-start,
  sums client-side — this module has no `sum()` aggregate helper
  precedent, so it matches `get_job_counts_by_status`'s existing
  client-side aggregation style).
- `get_budget_cap(user_id) -> float` — reads `budget_caps.monthly_usd_cap`,
  falling back to `DEFAULT_MONTHLY_USD_CAP = 5.00` (mirrors the column's
  own DB DEFAULT) when the row is missing.

### 4. LLM usage capture (`jobify/shared/llm.py`)

- Refactored `_oauth_complete` into a shared `_oauth_complete_raw(...)`
  that returns `(text, result_msg)`; `_oauth_complete` itself is now a
  thin wrapper (`return text` only) — same signature, same behavior,
  same tests pass unmodified.
- Added `CompletionUsage` (frozen dataclass: `input_tokens`, `output_tokens`)
  and `complete_with_usage(*, system, prompt, model, max_tokens) -> tuple[str, CompletionUsage]`,
  additive alongside `complete()` (which is untouched — same signature,
  same behavior, same callers).
  - API path: reads `resp.usage.input_tokens` / `.output_tokens` off the
    Messages API response (defensive `getattr` chain — a response with no
    `.usage` at all reports zero, doesn't crash).
  - OAuth path: the Claude Agent SDK's `ResultMessage.usage` is a
    `dict[str, Any] | None` (confirmed by reading the installed SDK's
    `types.py`, `claude_agent_sdk==0.2.110`) — when present, its
    `input_tokens`/`output_tokens` keys are used; when the stream ends
    without a `ResultMessage` envelope at all (the "text but no envelope"
    branch `_oauth_complete_raw` already handles), usage is genuinely
    unavailable and both counts are 0 — documented in the docstring, not
    silently guessed.
  - Mirrors `complete()`'s cool-off/benching auth-fallback chain exactly.

## What I tested

Set up a fresh `.venv` (`uv venv --python 3.11 .venv && uv pip install -e ".[dev]"`)
since none existed in this worktree.

Focused runs during development:
```
.venv/bin/python -m pytest -q tests/test_profile_loader_db.py -v   # 12 passed
.venv/bin/python -m pytest -q tests/test_portals_fanout.py tests/test_portals_config.py -v  # 11 passed
.venv/bin/python -m pytest -q tests/test_db_hosted.py -v           # 8 passed
.venv/bin/python -m pytest -q tests/test_shared_llm.py -v          # 31 passed
.venv/bin/python -m pytest -q tests/test_onboarding_example.py -v  # 5 passed
```

Full suite before committing:
```
.venv/bin/python -m pytest -q
# 517 passed, 1 skipped, 26 deselected in ~27s
.venv/bin/python -m pytest -q -m "legacy or integration"
# 25 passed, 2 skipped, 517 deselected
.venv/bin/python -m pytest -q -W error::RuntimeWarning tests/test_profile_loader_db.py tests/test_portals_fanout.py tests/test_db_hosted.py tests/test_shared_llm.py tests/test_onboarding_example.py
# 61 passed — pristine, no warnings anywhere in the suite
.venv/bin/ruff check jobify/profile_loader.py jobify/db.py jobify/shared/llm.py jobify/hunt/sources/_portals.py onboarding/validate_profile.py tests/test_profile_loader_db.py tests/test_portals_fanout.py tests/test_db_hosted.py tests/test_shared_llm.py tests/test_onboarding_example.py
# All checks passed!
```

Baseline (before any of my edits) was `492 passed, 1 skipped, 26 deselected`
— every pre-existing test still passes untouched (no existing test files'
logic was weakened; `tests/test_profile_loader_db.py`'s validation test was
strengthened, not loosened — see below).

### The required regression test

`tests/test_profile_loader_db.py::test_fan_out_materializes_two_users_without_cross_contamination`
— materializes two different users' profiles (with distinct `thesis.md`/
`cv.md` bodies) in the same fake-DB-backed process via
`materialize_profile_dir()`, then asserts each user's dir-parameterized
`load_thesis(dir)` / `load_cv(dir)` returns THAT user's own text, and that
the two texts differ from each other.

`tests/test_profile_loader_db.py::test_fan_out_does_not_touch_global_profile_dir_cache`
— primes `profile_dir()`'s global cache via `JOBIFY_PROFILE_DIR` (as
`jobify-hunt` would), runs `materialize_profile_dir()` for a DB user, then
asserts the global env-var path resolves and reads back exactly as
before — zero contamination in either direction.

`tests/test_portals_fanout.py` mirrors the same isolation properties for
`_portals.py`'s `_PORTALS_CACHE` (explicit-dir calls never read from or
write to the global cache; the zero-arg path still populates/reuses it
exactly as before).

## Files changed

- `jobify/profile_loader.py` — parameterized loaders, `materialize_profile_dir`,
  validation-status write, module docstring updates.
- `jobify/hunt/sources/_portals.py` — parameterized `_PORTALS_CACHE` access.
- `jobify/db.py` — `set_profile_validation_status`, `insert_budget_ledger_row`,
  `get_month_to_date_spend`, `get_budget_cap`, `DEFAULT_MONTHLY_USD_CAP`.
- `jobify/shared/llm.py` — `_oauth_complete_raw` refactor, `CompletionUsage`,
  `complete_with_usage`.
- `jobify/migrations/0004_worker.sql` (new) — `profiles.validation_status TEXT`.
- `jobify/migrations/README.md` — documents 0004, flags the H3 collision.
- `onboarding/validate_profile.py` — `validate_profile_dir` reads through
  dir-parameterized loaders instead of mutating `JOBIFY_PROFILE_DIR` /
  the `lru_cache`; unused `os` import removed.
- `tests/test_profile_loader_db.py` — fake client gains `.update()`
  tracking; validation-failure test now asserts the DB write (not just
  the log line); new validation-success test; two new fan-out regression
  tests.
- `tests/test_portals_fanout.py` (new) — `_PORTALS_CACHE` isolation tests.
- `tests/test_db_hosted.py` (new) — tests for the four new `jobify.db` helpers.
- `tests/test_shared_llm.py` — `ResultMessage` fake gains an optional
  `usage` kwarg; 9 new tests for `complete_with_usage` (API path, OAuth
  path, zero-usage edge cases, real fake-SDK end-to-end, `complete()`
  unaffected).
- `tests/test_onboarding_example.py` — new test pinning
  `validate_profile_dir`'s no-process-global-mutation property.

`git diff --stat` confirms nothing under `web/`, `dashboard/`,
`jobify/tailor/`, `jobify/submit/`; `0002_multitenant.sql` untouched;
`0003_hosted_onboarding.sql` doesn't exist in this worktree (H3 owns it
in a separate worktree).

## Self-review findings

- Initially wrote `_validate_materialized` to *replace* logging with the
  DB write per a literal reading of "instead of logging and continuing";
  decided to keep the WARNING log too (operator visibility costs
  nothing, and the DB write — not the log — is what Task 3 will actually
  gate on). Flagging this judgment call in case the controller wants the
  log removed.
- Found that the existing `_DOC` test fixture in `test_profile_loader_db.py`
  doesn't actually satisfy the strict jsonschema required-key checks
  (missing `application_defaults` in `profile.yml`, missing ATS keys in
  `portals.yml`) — so every pre-existing test using it was already
  silently hitting the "invalid" branch of validation (previously
  invisible; now it will now also write `validation_status='invalid'`
  for these tests, which is correct behavior, just previously masked).
  I did not touch the shared fixture (out of scope, other tests may
  depend on its exact shape) and instead used the golden
  `onboarding/examples/profile/` example (already pinned valid by
  `tests/test_onboarding_example.py`) for the new "writes 'valid'"
  positive test.
- Confirmed via the installed SDK's source (`claude_agent_sdk==0.2.110`,
  `types.py::ResultMessage`) that `.usage` is a real, populated field
  before writing `complete_with_usage`'s OAuth-path extraction, rather
  than guessing its shape.

## Concerns for the controller

1. **`profiles.validation_status` naming/type collision with H3** (detailed
   above and in `jobify/migrations/README.md`). Both `0004_worker.sql`
   (this task, `TEXT`) and H3's forthcoming `0003_hosted_onboarding.sql`
   (`jsonb`, per its session prompt) add a column with the same name for
   different purposes. Needs reconciliation before both branches merge —
   whichever migration applies second will hit "column already exists"
   (harmless with `IF NOT EXISTS`, but the two ADD COLUMN statements
   disagree on type) or leave the column shaped for only one consumer.
2. I created a `.venv` in this worktree (gitignored) to run the test
   suite — not committed, but future sessions on this branch will need
   to either reuse it or set up their own.

---

# Code-review fix: dedupe Messages-API auth-fallback chain (`jobify/shared/llm.py`)

## Finding addressed

The Messages-API auth-fallback chain (cool-off check, `try/except` +
`is_api_key_unusable_error` + `mark_api_key_unusable()` + `logger.warning`,
OAuth-token fallback check, final `RuntimeError`) was duplicated
near-verbatim between `complete()` and `complete_with_usage()`, unlike the
already-factored `_oauth_complete_raw`/`_oauth_complete` pattern elsewhere
in the file.

## Fix

- Added `_complete_raw(*, system, prompt, model, max_tokens) -> tuple[str, CompletionUsage]`
  that owns the entire auth-fallback chain (Messages API try/except/bench,
  OAuth fallback via `_oauth_complete_raw`, final `RuntimeError`) and
  always computes a `CompletionUsage` (real counts on the API path;
  extracted from `ResultMessage.usage` on the OAuth path; all-zero when
  genuinely unavailable).
- `complete()` is now a thin wrapper: calls `_complete_raw(...)` and
  returns just the text — signature, return type, and behavior unchanged
  for its existing callers.
- `complete_with_usage()` is now a thin wrapper: returns `_complete_raw(...)`
  directly — signature and behavior (added in the prior commit) unchanged.
- Moved the `CompletionUsage` dataclass above `_complete_raw` (it's
  referenced at call time, not def time, so no forward-reference issue;
  moved for readability since it's now the shared return shape for both
  callers, not just `complete_with_usage`'s).
- Updated the module docstring's "two places make real model calls" note:
  it named `_oauth_complete` as the patchable OAuth call site; the merged
  chain now calls `_oauth_complete_raw` directly (needed for `ResultMessage`
  usage extraction on both the text-only and usage-capturing side), so the
  docstring now names `_oauth_complete_raw` and notes `complete()`/
  `complete_with_usage()` are thin wrappers around `_complete_raw()`.

### Test file adjustment (required, not optional)

`tests/test_shared_llm.py` had two tests that monkeypatched `_oauth_complete`
(the thin, text-only OAuth wrapper) to intercept `complete()`'s OAuth
fallback: `test_billing_error_benches_key_and_falls_through_to_oauth` and
`test_missing_key_uses_oauth_directly`. Since the merged `_complete_raw`
now calls `_oauth_complete_raw` directly (it needs the `ResultMessage` for
usage extraction, which the thin `_oauth_complete` wrapper discards),
patching `_oauth_complete` no longer intercepts anything — the unpatched
real `_oauth_complete_raw` would run and attempt to lazy-import
`claude_agent_sdk`. Retargeted both monkeypatches to `_oauth_complete_raw`
and updated their fakes' return shape from a bare string to
`(text, None)`, matching `_oauth_complete_raw`'s actual contract. This is
the expected consequence of the refactor's call-graph change, not a
loosening of coverage — same assertions, same call-count checks, just
patched at the correct seam. `complete()`'s two other OAuth-adjacent tests
(`test_api_path_returns_joined_text_without_touching_oauth`,
`test_rate_limit_error_propagates_and_does_not_bench`) patch `_oauth_complete`
only as a "must not be called" guard and needed no change since OAuth is
never reached in either case.

Also fixed the stale `onboarding/validate_profile.py` module docstring
(lines 11-13): it said the checks work "by pointing `JOBIFY_PROFILE_DIR`
at the target dir"; `validate_profile_dir` was refactored in the prior
commit to pass the target dir directly to dir-parameterized loaders and no
longer touches `JOBIFY_PROFILE_DIR` at all. Reworded to match, mirroring
`validate_profile_dir`'s own (already-accurate) docstring.

## Verification

```
.venv/bin/python -m ruff check jobify/shared/llm.py onboarding/validate_profile.py
# All checks passed!

.venv/bin/python -m pytest -q tests/test_shared_llm.py
# 31 passed in 0.72s

.venv/bin/python -m pytest -q
# 517 passed, 1 skipped, 26 deselected in 29.46s
```

Pass count is unchanged from the baseline noted in the original report
(517 passed, 1 skipped, 26 deselected) — confirmed identical, no drift.

## Files changed

- `jobify/shared/llm.py` — extracted `_complete_raw`; `complete()` and
  `complete_with_usage()` are now thin wrappers; module docstring updated.
- `onboarding/validate_profile.py` — module docstring corrected (no
  functional change).
- `tests/test_shared_llm.py` — retargeted two OAuth-fallback monkeypatches
  from `_oauth_complete` to `_oauth_complete_raw` to match the new call
  graph (required for the tests to keep passing; not a coverage change).
