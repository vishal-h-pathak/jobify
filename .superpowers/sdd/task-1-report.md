# Task 1 report — `jobify/hosted/learning.py`: the incremental learning pass

## What was implemented

Exactly the brief's three pieces, transcribed verbatim except one necessary correctness fix
(see "Deviation from the brief" below):

1. **`jobify/db.py`** — four new functions added directly after `get_unmatched_postings`:
   `get_posting_reactions`, `get_matches_by_states`, `get_postings_by_ids`,
   `update_profile_doc_file`. Verbatim from the brief.

2. **`jobify/hosted/fanout.py`**:
   - `_cost_usd` → `cost_usd` (def + both call sites: `_stage4_verdict`, `_ensure_rubric`).
   - `_targeting_text` → `targeting_text` (def + **both** actual call sites — the brief said
     "its one call site in `_ensure_rubric`", but the file as it actually stands has a *second*
     call site in `_profile_embed_text` that the brief's prose missed; both had to be updated
     for the rename to not break the module).
   - New learning-pass call added at the very end of `_run_user_ladder`, right before
     `counters["users_processed"] += 1`, exactly as specified (lazy import, `# noqa: PLC0415`).

3. **`jobify/hosted/learning.py`** (new file) — the full module verbatim from the brief:
   watermark parsing, event-action mapping, matched-group recovery via `rubric.score_posting`,
   event collection since the watermark, weight-delta computation, insight-line rendering, and
   the reweight-vs-recompile branch, all wrapped in `run_learning_pass`'s try/except.

## Deviation from the brief (and why)

Renaming `_targeting_text` → `targeting_text` collides with a **local variable of the same
name** inside `_ensure_rubric`:

```python
targeting_text = _targeting_text(load_profile(profile_dir))   # brief's literal rename target
```

If the function is renamed to `targeting_text` and this local variable keeps its name, the line
becomes `targeting_text = targeting_text(load_profile(profile_dir))`. Because Python treats any
name assigned anywhere in a function body as local for the *entire* function, the right-hand
side reference to `targeting_text` would resolve to the (not-yet-assigned) local variable, not
the module-level function — `UnboundLocalError` at that exact line, every time `_ensure_rubric`
compiles a new rubric.

Fix: renamed the local variable to `targeting_tier_text` (used only within `_ensure_rubric`;
the `compile_kwargs` dict still passes it through as the `targeting_text=` keyword, unchanged).
Left an inline comment explaining why. No other call site had a colliding local name (the
`_profile_embed_text` local is already called `targeting`, and `_cost_usd`'s two call sites
both assign to a local called `cost`, not `cost_usd`).

This is not a design decision — it's the minimum change required for the rename the brief
specifies to actually execute without crashing. Did not stop to ask given how mechanical and
unambiguous the fix is; flagging it here for the record per the self-review checklist.

## Tests written / extended

- **`tests/test_db_hosted.py`**: added `.in_()` to the shared `_FakeQuery` (mirrors `.eq()`'s
  filter-and-return-self shape). Added 8 new tests: `get_posting_reactions` (per-user
  filtering), `get_matches_by_states` (state-list filtering), `get_postings_by_ids` (matching
  rows + empty-input-issues-no-query), `update_profile_doc_file` (merge-preserves-other-keys,
  no-op when profiles row missing, no-op when `doc` isn't a dict).
- **`tests/test_hosted_fanout.py`**: existing 26 tests confirmed green unmodified. Added one new
  test, `test_run_user_ladder_calls_learning_pass_after_scoring`, asserting
  `learning.run_learning_pass` is called exactly once with `(user_id, profile_dir)` positionally
  and `api_key`/`counters` as kwargs, and that call happens strictly after this cycle's
  `db.upsert_match` calls (order asserted via one shared event list both fakes append to, not
  just a count).
- **`tests/test_hosted_learning.py`** (new): all ~10 scenarios from the brief:
  1. No compiled rubric → early return, reactions/matches never queried.
  2. Watermark incrementality (rows before/at/after the watermark; only after-rows become
     events).
  3. Fresh (empty) file → every existing row becomes an event.
  4. Matched-groups recovery — a real 2-group rubric + a real `score_posting` call; the event's
     `matched_groups` contains only the group whose term hit.
  5. Reweight persisted — real `apply_feedback` run against a real small rubric; new weight
     matches the multiplier.
  6. Recompile fires at the `NEEDS_RECOMPILE_MIN_EVENTS` threshold with exactly one
     `rubric_recompile` ledger row, and the incremental `apply_feedback` path is provably NOT
     also taken.
  7. Append-only insights across two passes — first pass's exact bullet line verified present
     verbatim (byte-level substring check) after a second pass appends a second line.
  8. Sub-threshold reweight persists with no insight line — see note below on how this had to
     be constructed.
  9. Failure isolation — `db.get_posting_reactions` raises; `run_learning_pass` returns
     normally; `set_compiled_rubric`/`update_profile_doc_file` never called.
  10. Direct `_event_action` mapping test (reaction `interested`/`not_interested`, match
      `saved`/`applied`/`dismissed`/`new`/`seen`, plus an unrecognized value → `None`).

### TDD evidence (RED → GREEN) for scenario 8

Wrote the sub-threshold test first assuming a single save event (1.0 → 1.05, a nominal 5%
nudge) would stay *at* the threshold and produce no insight line. RED:

```
assert after_lines == before_lines == []
E   assert ['- 2020-01-0...after 1 save'] == []
```

Root cause (floating point, not a bug in `learning.py`): `1.0 * 1.05 == 1.05`, but
`(1.05 - 1.0) / 1.0 == 0.050000000000000044` — strictly greater than
`INSIGHT_DELTA_THRESHOLD = 0.05`, so a single save event's delta is *never* genuinely
sub-threshold; it just barely clears it every time. Fixed the test (not the code) by starting
the group's weight near `FEEDBACK_WEIGHT_MAX` (`10.0 - 0.2 = 9.8`) so the clamp caps the nudge
at `10.0`, giving a real delta of `~2.04%` — genuinely below 5%. GREEN after that change; full
run below.

## Test commands run and output

```
$JOBIFY_MAIN_VENV/bin/python -m pytest tests/test_db_hosted.py tests/test_hosted_fanout.py tests/test_hosted_learning.py -q
........................................................................ [ 84%]
.............                                                            [100%]
85 passed in 0.28s
```

```
$JOBIFY_MAIN_VENV/bin/python -m pytest -q          # full repo suite, from repo root
........................................................................ [ 10%]
........................................................................ [ 21%]
........................................................................ [ 32%]
........................................................................ [ 43%]
........................................................................ [ 54%]
........................................................................ [ 65%]
........................................................................ [ 76%]
........................................................................ [ 87%]
........................................................................ [ 98%]
..........                                                               [100%]
658 passed, 1 skipped, 26 deselected in 24.97s
```

Re-ran with `-rw` (warnings summary) on both the targeted files and the full suite: no warnings
in either run — pristine output.

Also ran `bash scripts/scrub_gate.sh`: `scrub gate: PASS`.

(Note on environment: this worktree's own `.venv` has no `pytest`/project deps installed and
`uv sync` fails to resolve `claude-agent-sdk` offline — pre-existing environment issue,
unrelated to this task. Ran tests via the sibling `jobify/.venv` (same repo, Python 3.11,
pytest 9.1.0, `jobify` installed editable) with this worktree as the cwd — confirmed via `pwd`
before each run and via `git diff --stat` only ever showing this worktree's own files.)

## Files changed

- `jobify/db.py` — four new functions (`get_posting_reactions`, `get_matches_by_states`,
  `get_postings_by_ids`, `update_profile_doc_file`).
- `jobify/hosted/fanout.py` — `_cost_usd`→`cost_usd`, `_targeting_text`→`targeting_text` (all
  call sites), local-variable rename in `_ensure_rubric` to avoid the shadow, new learning-pass
  call site in `_run_user_ladder`.
- `jobify/hosted/learning.py` (new) — the learning-pass module.
- `tests/test_db_hosted.py` — `.in_()` on `_FakeQuery`, 8 new tests.
- `tests/test_hosted_fanout.py` — 1 new test, `learning` import added.
- `tests/test_hosted_learning.py` (new) — 10 tests.

## Self-review findings

- All ~10 scenarios from the brief are covered by a test (see list above); none skipped.
- No budget-cap gating added to the recompile branch — confirmed the implementation only writes
  the one `rubric_recompile` ledger row, no new `allow_new_compile`-style check, per the global
  constraints' explicit scope decision.
- `run_learning_pass` never raises: the entire body is delegated to `_run_learning_pass_inner`
  inside a bare `except Exception` in `run_learning_pass` itself — confirmed by test 9 (failure
  isolation) and by the existing `test_hosted_fanout.py` suite passing unmodified (those tests
  don't fake the four new `db.py` reads, so `learning.run_learning_pass` hits the real
  unpatched `_get_client()` and its own internal try/except swallows the resulting error
  silently, exactly as the brief predicted).
- Names are clear; the one local-variable rename (`targeting_tier_text`) is commented in place
  explaining why it isn't just `targeting_text`.
- Full test suite green, pristine (no warnings) both for the three targeted files and the whole
  repo.

## Concerns

- The brief's description of `_targeting_text`'s call sites ("its one call site in
  `_ensure_rubric`") didn't match the file as it currently stands (a second call site exists in
  `_profile_embed_text`, added by a later stage-3 embedding task after the brief's prose was
  presumably written). Not a blocker — updating both was the only way to keep the module
  importable — but flagging since the brief's text and the actual file diverged here.
- The `_ensure_rubric` local-variable shadow (see "Deviation from the brief" above) is a latent
  correctness issue the brief's exact-code instructions would have introduced if followed
  completely literally; fixed via a local rename rather than raised as a blocker, since the fix
  is unambiguous and doesn't change any observable behavior (confirmed by the full test suite,
  including the untouched `test_hosted_fanout.py` rubric-compile tests, staying green).
