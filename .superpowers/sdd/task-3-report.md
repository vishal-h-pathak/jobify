# Task 3 report — Per-user fan-out ladder (H4)

## What I implemented

### `jobify/hosted/fanout.py` (new)

`run_fanout_cycle(user_ids: Optional[list[str]] = None) -> dict` — the
entry point Task 4 wires into a console script. Defaults to
`db.list_profile_user_ids()`; an explicit list is a
testing/single-user-targeting hook. Iterates every user, wraps each
user's ladder in a try/except so one user's failure never aborts the
cycle (same resilience pattern as `discovery.run_discovery_cycle` /
`jobify.hunt.agent.iter_all_jobs`), and returns a summary dict:
`users_processed`, `users_skipped_invalid`, `users_errored`,
`postings_scored`, `matches_written`, `stage4_calls`,
`users_budget_stopped`.

`_run_user_ladder(user_id, counters)` runs the four stages for one user,
linearly (no early returns past the validation-status check — every
stage's input list is simply empty when the prior stage found nothing,
so downstream loops no-op rather than needing their own guard):

1. **Validation-status gate.** `db.get_profile_validation_status(user_id)`
   (new helper). `'invalid'` skips the user entirely (no stages run, no
   writes). `None` (never validated — e.g. `onboarding` import failed)
   proceeds, per the brief's fail-open contract.
2. **Stage 1 — title filter.** `sources._portals.passes_title_filter(title,
   profile_dir)`, already dir-parameterized by Task 1. A failure gets NO
   `matches` row.
3. **Stage 2 — compiled rubric.** `db.get_compiled_rubric` /
   `jobify.hunt.rubric.score_posting`. Compiles once (see below) and
   persists via `db.set_compiled_rubric` when `NULL`. A hard disqualify
   gets NO `matches` row (not a zero-score row). Everything else writes
   `rubric_score`, `reason = "; ".join(result.reasons)`,
   `reason_source='rubric'`.
4. **Stage 3 — embedding rerank.** `jobify.hosted.embed.ensure_profile_embedding`
   / `ensure_posting_embedding` + a plain-Python cosine (`_cosine`, no
   numpy — checked `pyproject.toml`, not a dependency). Cleanly skips
   (dict stays empty) when `embed.embeddings_enabled()` is `False` or
   either vector comes back `None` for a given pair; `embed_score` stays
   `NULL` for those postings and the ladder proceeds 1→2→4 unaffected.
5. **Stage 4 — LLM verdict.** Budget-gated: `db.get_month_to_date_spend(user_id)`
   vs `db.get_budget_cap(user_id)`; at/over cap skips stage 4 entirely
   for that user this cycle (stages 1-3 already wrote their rows).
   Otherwise the top `HOSTED_STAGE4_TOP_N` (new `jobify/config.py`
   constant, default 15, env-tunable) survivors by a composite ranking
   key (`_composite_score`) get one Haiku-class call each
   (`STAGE4_MODEL = "claude-haiku-4-5"`), writing `llm_score`, `reason`,
   `reason_source='llm'` and an `event='llm_verdict'` ledger row (real
   tokens via `complete_with_usage`).

**Composite ranking (documented choice, brief asked for one):**
`rubric_score` alone when stage 3 didn't score a posting; an
**unweighted mean** of `rubric_score` and `embed_score` when both are
present. Rationale: a weighted blend would bake in an arbitrary prior
about which signal to trust more before any real calibration data
exists; an unweighted mean keeps both stages' influence on ranking equal
until save/dismiss feedback (the rubric's own feedback loop) gives a
reason to skew either way.

**Stage-4 prompt: option (b), purpose-built** (brief left this as my
call). `jobify.hunt.scorer.score_job` was ruled out for the reason the
brief flags (`build_profile_prompt_string()`'s process-global
`_PROFILE_CACHE`); rather than dir-parameterizing that function (option
a), I wrote a small dedicated system prompt (`_STAGE4_SYSTEM`) directly
in `fanout.py` and a user message built from `load_thesis(profile_dir)`
+ the posting fields. Two reasons over option (a): (1) `score_job`'s
output shape (score/tier/degree_gated/recommended_action/legitimacy/
legitimacy_reasoning, Opus-class, `max_tokens=600`) doesn't match what
stage 4 needs (a simple `{score, reason}` verdict, Haiku-class,
`max_tokens=300`) — reusing it would mean parsing fields the ladder
throws away; (2) every profile read in `fanout.py` already goes through
dir-parameterized loaders with **zero caching anywhere in the call
path** — isolation is correct by construction, not by discipline around
a shared cache. `jobify/hunt/prompts/__init__.py` is untouched.

### `jobify/hunt/rubric.py` — `compile_rubric_with_usage` (new, additive)

The brief calls for `complete_with_usage` (real token counts) on the
rubric-compile ledger row, but `compile_rubric` internally calls
`llm.complete` (no usage) and its existing tests
(`tests/test_hunt_rubric.py`) monkeypatch `rubric.llm.complete` directly
— changing `compile_rubric`'s internals would have broken those
untouched tests. Added `compile_rubric_with_usage(*, thesis,
disqualifiers_text, targeting_text) -> tuple[dict, llm.CompletionUsage]`
as a separate, additive sibling with the identical retry/validate loop,
calling `complete_with_usage` and summing usage across the (up to two)
attempts (a retry still spends real tokens the ledger must account
for). `compile_rubric` itself is byte-identical to before Task 3.

### `jobify/db.py` additions

- `get_profile_validation_status(user_id) -> str | None`
- `get_compiled_rubric(user_id) -> dict | None` / `set_compiled_rubric(user_id, rubric)`
- `upsert_match(user_id, posting_id, **fields) -> None` — on-conflict
  `(user_id, posting_id)`, the table's actual PK. **Never** includes
  `state` / `state_changed_at` in the payload it sends — Postgrest's
  upsert only touches columns present in the payload on conflict, so a
  first insert gets the column's own DB DEFAULT (`'new'`) and a
  re-score of an already-triaged row (`saved`/`dismissed`/`applied`)
  leaves that column completely alone.
- `get_unmatched_postings(user_id) -> list[dict]` — client-side
  anti-join (fetch this user's matched posting ids, fetch all postings,
  filter in Python). **Known scale limit** (same category as Task 2's
  `list_profile_user_ids` note): the Supabase Python client has no clean
  `NOT IN (subquery)`; acceptable at H4's scale, revisit if either
  table's row count makes the full-table pulls expensive.

### `jobify/config.py`

`HOSTED_STAGE4_TOP_N` — soft-default int, `HOSTED_STAGE4_TOP_N` env var,
default `15`, following the module's existing convention.

## Targeting-tier key (verified, not guessed)

`profile.yml`'s targeting block is `what_he_is_looking_for` (a dict of
`tier_N -> {label, notes, reference_role}`), confirmed against BOTH
`onboarding/schema/profile.schema.json` (`"what_he_is_looking_for"`,
`additionalProperties` requiring `label`) and `profile.example/profile.yml`.
`_targeting_text()` renders it as label/reference_role/notes lines for
`compile_rubric`'s `targeting_text` input.

## Cross-user isolation (the headline requirement)

Both LLM call sites in the ladder (rubric compile, stage-4 verdict) are
proven isolated with real regression tests, not just re-labeled:

- `tests/test_hosted_fanout.py::test_stage4_never_leaks_profile_across_users`
  — two users, two theses, ONE shared posting (mirrors the real shared
  `postings` pool), scored in one `run_fanout_cycle(["user-a", "user-b"])`
  call. The fake `llm.complete_with_usage` asserts inside itself that a
  prompt containing user A's thesis marker never also contains user B's
  (and vice versa), and the test separately asserts each user's written
  `llm_score`/`reason` reflects only their own thesis.
- `tests/test_hosted_fanout.py::test_rubric_compile_never_leaks_profile_across_users`
  — same property for the sibling LLM call site (rubric compile), which
  the brief explicitly calls out as the same class of hazard in a
  sibling module.

Both pass because of construction, not luck: `fanout.py` never imports
or calls `build_profile_prompt_string()` or anything backed by
`_PROFILE_CACHE`/`_PORTALS_CACHE` without an explicit `profile_dir`.

## What I tested

- `tests/test_hosted_fanout.py` (new, 14 tests): stage-1 filter drop, stage-2
  hard-disqualify drop, stage-2 score/reason write, ladder-ordering
  (top-N exact set), budget stop (stages 1-3 still ran, zero
  `llm_verdict` ledger rows), invalid-profile full skip, never-validated
  (`None`) fail-open, state-preservation (`upsert_match` payloads never
  carry `state`/`state_changed_at`), stage-3 cosine rerank driving
  top-N selection (real vector math, not mocked away), stage-3
  clean-skip when disabled, both cross-user isolation tests, one-user's-
  failure resilience, and the default-roster entry point.
- `tests/test_db_hosted.py` (+14 tests): the five new `db.py` helpers —
  validation-status get, compiled-rubric get/set, `upsert_match` payload
  shape + on-conflict target + the state-column omission contract,
  `get_unmatched_postings` anti-join (including a same-posting-different-
  user isolation check).
- `tests/test_hunt_rubric.py` (+4 tests): `compile_rubric_with_usage`
  returns usage, sums usage across a retry, raises identically to
  `compile_rubric` on unrecoverable invalid JSON, and — the regression
  that protects the existing behavior — `compile_rubric` itself still
  calls `llm.complete` (not `complete_with_usage`), proven by making
  `complete_with_usage` raise if called.

### Results

```
$ python -m pytest tests/test_hosted_fanout.py tests/test_db_hosted.py tests/test_hunt_rubric.py -q
14 passed  (fanout)
30 passed  (db_hosted, 14 new)
24 passed  (hunt_rubric, 4 new)

$ python -m ruff check jobify/hosted/ jobify/db.py jobify/config.py
All checks passed!

$ python -m pytest -q   # full suite
582 passed, 1 skipped, 26 deselected
```

Baseline (pre-Task-3, `git stash -u`) full suite: `553 passed, 1
skipped, 26 deselected` — all pre-existing tests still pass unmodified;
net +29 new tests (some test files' pre-existing counts weren't
independently re-verified pass/fail, only the aggregate delta, so this
number is directional, not a precise per-file diff).

Zero warnings in the full-suite output (`grep -i warning` on the run:
no matches).

### Ruff

`jobify/hosted/`, `jobify/db.py`, `jobify/config.py` all pass `ruff
check` cleanly (not excluded, per the brief). `jobify/hunt/` remains
excluded by the repo's own `pyproject.toml` (`extend-exclude`), so my
`rubric.py` addition wasn't lint-gated by this task's requirement
either way, but I ran it anyway and it's clean.

One pre-existing, unrelated ruff failure was found during a full-repo
`ruff check .`: `tests/test_prefill_stop_at_submit.py` (E402, imports
not at top of file) — confirmed via `git stash` that it predates this
task and is outside `jobify/hosted/`'s scope; left untouched.

## TDD evidence

Representative RED/GREEN pair (`compile_rubric_with_usage`, before it
existed):

```
RED:
  AttributeError: module 'jobify.hunt.rubric' has no attribute
  'compile_rubric_with_usage'

GREEN (after adding the function):
  tests/test_hunt_rubric.py::test_compile_rubric_with_usage_returns_rubric_and_real_token_counts PASSED
  tests/test_hunt_rubric.py::test_compile_rubric_with_usage_sums_tokens_across_retry PASSED
  tests/test_hunt_rubric.py::test_compile_rubric_with_usage_raises_after_two_invalid_attempts PASSED
  tests/test_hunt_rubric.py::test_compile_rubric_still_uses_plain_complete_unaffected_by_new_sibling PASSED
```

The fan-out ladder itself (`fanout.py`) was written test-first at the
module level: `tests/test_hosted_fanout.py` was drafted against the
brief's stage descriptions before the corresponding branches in
`_run_user_ladder` existed, then implementation filled in to make each
assertion pass (one early RED I hit and fixed: my first
`_fixed_verdict_llm` test helper built JSON with `repr()`, producing
single-quoted invalid JSON — `test_upsert_match_calls_never_touch_state_columns`
failed with `1 == 2` because the stage-4 call's response was
unparseable and silently dropped; fixed by switching to `json.dumps`).

## Files changed

- `jobify/hosted/fanout.py` (new)
- `jobify/hunt/rubric.py` (added `compile_rubric_with_usage` + a shared
  `_compile_user_msg` helper; `compile_rubric` unchanged)
- `jobify/db.py` (5 new helpers, see above)
- `jobify/config.py` (`HOSTED_STAGE4_TOP_N`)
- `tests/test_hosted_fanout.py` (new)
- `tests/test_db_hosted.py` (+14 tests)
- `tests/test_hunt_rubric.py` (+4 tests)

No migration changes — `profiles.compiled_rubric` (0002) and the
`matches` score/reason columns (0002) already had everything this task
needed; `0004_worker.sql` untouched.

## Self-review findings

- **Deferred rubric compile.** `_ensure_rubric` is only called when
  `survivors` (stage-1 passers) is non-empty — if a user's title filter
  rejects every posting in a cycle, the rubric never compiles that
  cycle (deferred to whenever there's actually something to score
  against). This avoids spending the one-time Sonnet-class compile call
  on a cycle with nothing to score. Not explicitly required by the
  brief; flagging as an intentional efficiency choice in case Task 4 or
  a reviewer expected proactive compilation.
- **No profile-embedding force-recompute.** `embed.py`'s docstring left
  "when to force a recompute" to this task; I call
  `ensure_profile_embedding(user_id, text)` without `force=True`
  anywhere, so once a profile embedding exists it's never refreshed even
  after a thesis edit. Implementing change-detection (comparing
  `profiles.updated_at` against embedding-write bookkeeping) felt like
  scope the brief didn't ask for (YAGNI) and would need its own
  bookkeeping column/mechanism — flagging as a known gap rather than
  quietly deciding it for H6/a later task.
- **Stage-4 cost pricing constants** (`RUBRIC_COMPILE_*_USD_PER_MTOK`,
  `STAGE4_*_USD_PER_MTOK`) are approximate published rates, env-tunable,
  following `jobify.hunt.rescore`'s existing precedent for the same
  problem (scorer-cost estimation) rather than a hardcoded, unlabeled
  number — but they are still estimates, not verified against a live
  Anthropic invoice. Ledger `input_tokens`/`output_tokens` are always
  the real API-reported counts; only `cost_usd`'s conversion rate is
  approximate.
- Ran `ruff check .` across the whole repo (not just my files) as an
  extra check beyond the brief's ask; found the one pre-existing,
  out-of-scope failure noted above and left it alone per the
  parallel-safe-boundaries constraint (don't touch `jobify/submit/` or
  its tests).

No functional issues found in self-review; no changes made post-review
beyond what's captured above as documented, intentional decisions.

## Fix note — profile-embedding recompute on thesis change (post-review)

Review flagged the self-review gap above as an Important defect, not just
a documented gap: stage 3's cosine rerank silently kept using a user's
FIRST-EVER profile embedding forever, even after a `thesis.md` edit —
unlike stage 2 (rubric, re-reads `load_thesis` fresh) and stage 4 (LLM
verdict, same), which both reflect edits immediately. `embed.py`'s
docstring and the original brief both framed "recompute when the
profile's underlying text changed" as the expected behavior.

**Mechanism (no migration, no new `profiles` column):** two on-disk stamp
files, both living in the same per-user cache dir
`materialize_profile_dir(user_id)` already returns:

- `profile_loader.materialize_profile_dir` already writes
  `.materialized_updated_at` (`_STAMP_FILENAME`) recording
  `profiles.updated_at` on every (re)materialization. Added
  `profile_loader.get_materialized_updated_at(profile_dir) -> str` to read
  it back — zero extra DB round-trips, reuses the fetch
  `materialize_profile_dir` already did.
- `fanout.py` adds its own sibling stamp, `.embedding_stamp`
  (`_EMBEDDING_STAMP_FILENAME`), recording the `updated_at` value as of
  the last successful profile-embedding recompute
  (`_embedding_stamp_path` / `_embedding_is_stale` / `_mark_embedding_fresh`).

In `_stage3_embed_rerank`: compare `get_materialized_updated_at(profile_dir)`
against `.embedding_stamp` via `_embedding_is_stale` to compute `force`,
pass `force=force` into `embed.ensure_profile_embedding`, and only rewrite
`.embedding_stamp` when `ensure_profile_embedding` actually returns `True`
(a real recompute happened) — a failed/no-op call leaves the stamp stale
so the next cycle retries rather than silently accepting a missing or
outdated vector. Unchanged profiles compare equal on the second cycle and
skip the recompute (no wasted Voyage call / ledger row every cycle); a
changed `profiles.updated_at` (thesis edit -> re-materialization ->
`.materialized_updated_at` moves) makes the comparison unequal and forces
exactly one fresh recompute, after which the stamps re-converge.

**Tests added** (`tests/test_hosted_fanout.py`):
`test_embedding_recompute_skipped_when_profile_unchanged` (two cycles,
same `.materialized_updated_at` -> `force` sequence `[True, False]`) and
`test_embedding_recompute_triggered_when_profile_updated_at_changes`
(stamp file rewritten between cycles -> `force` sequence `[True, True]`).
Both fake `embed.ensure_profile_embedding` directly to isolate the `force`
decision from Voyage-call mechanics (already covered elsewhere).

**Results:**

```
$ python -m pytest tests/test_hosted_fanout.py tests/test_hosted_embed.py tests/test_db_hosted.py -q
61 passed (was 59; +2 new)

$ python -m pytest -q   # full suite
584 passed, 1 skipped, 26 deselected   (was 582 passed pre-fix)

$ python -m ruff check jobify/hosted/fanout.py jobify/profile_loader.py tests/test_hosted_fanout.py
All checks passed!
```

Files touched: `jobify/hosted/fanout.py`, `jobify/profile_loader.py`
(additive `get_materialized_updated_at`), `tests/test_hosted_fanout.py`.
No migration, no `0004_worker.sql` change.
