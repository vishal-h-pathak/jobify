# Task 4 report — handleTurn.ts module-completion glue

## Summary

Wired `range`/`evidence` module completion into `handleOnboardingTurn`, per the brief's exact
logic. `SessionSnapshot` gained a required `modules: ModulesState` field; the one call site
(`web/app/api/onboarding/turn/route.ts`) supplies it via `(session.modules ?? {}) as ModulesState`.
All existing tests pass unmodified; 4 new test cases added. `tsc --noEmit` clean.

## What was implemented

1. **`web/lib/onboarding/handleTurn.ts`**
   - Added `import { markModuleComplete, MODULE_REGISTRY, type ModulesState } from "./moduleRegistry"`.
   - `SessionSnapshot` gained `modules: ModulesState`.
   - Resume-skip branch (`session.stage === "resume" && userMessage === RESUME_SKIP_MESSAGE`):
     computes `const modules = markModuleComplete({ modules: session.modules }, "evidence", "built
     from your answers")` unconditionally, and passes `modules` into that branch's `saveSession`
     call.
   - After `const { extracted, stage, done } = applyToolCalls(...)`: computes `let modules:
     ModulesState = session.modules`, checks whether `record_calibration` / `record_resume` fired
     this turn via `turnResult.toolCalls.some(...)`, and — if fired and the corresponding
     `MODULE_REGISTRY.range.receipt` / `MODULE_REGISTRY.evidence.receipt` returns non-null — calls
     `markModuleComplete({ modules }, "range"|"evidence", receipt)`, threading the local `modules`
     variable so both can fire independently in the same turn.
   - `modules` is now passed into both `saveSession` calls at the bottom of the main function
     (the `done` branch and the `else` branch).
   - Did NOT call `maybeFireCheckpoint` and did NOT add a `finish_interview` module mark, per the
     brief's constraint #5 — `finish_interview` still closes the block via `stage`/`status` only.

2. **`web/app/api/onboarding/turn/route.ts`**
   - Added `import type { ModulesState } from "@/lib/onboarding/moduleRegistry"`.
   - Added `modules: (session.modules ?? {}) as ModulesState` to the `session: {...}` object
     literal passed into `handleOnboardingTurn`.

3. **`web/lib/onboarding/handleTurn.test.ts`**
   - `baseSession()` now defaults `modules: {}` (required by the widened `SessionSnapshot` type;
     purely a fixture addition, does not touch any existing assertion).
   - Added a new `describe("V3A-B2: module-completion glue", ...)` block with the four cases the
     brief specifies:
     (a) `record_calibration` fires → `saveSession` called with
     `modules: expect.objectContaining({ range: expect.objectContaining({ receipt: "4 answers" }) })`.
     (b) `record_resume` fires → `modules.evidence.receipt === "resume added"`.
     (c) resume-skip path → `modules.evidence.receipt === "built from your answers"`.
     (d) a turn firing neither tool (fires `record_identity` instead) → `session.modules` fixture
     (a non-empty `{ anchor: {...} }`) round-trips unchanged into the `saveSession` call.

## Verification

- Confirmed the brief's assumed receipt semantics against the actual
  `web/lib/onboarding/moduleRegistry.ts` before writing code: `rangeReceipt` returns `"4 answers"`
  when `extracted.calibration` is truthy else `null`; `evidenceReceipt` returns `"resume added"`
  when `extracted.resume?.cv_markdown` is a non-blank string, else `"built from your answers"`
  when `extracted.calibration` is truthy, else `null`. Both matched the brief exactly.
- Confirmed `web/lib/onboarding/maybeGenerateCalibration.ts` has its own separate
  `CalibrationSessionSnapshot` type (no `modules` field) and never calls `handleOnboardingTurn` —
  correctly out of scope, untouched.
- Confirmed `web/app/api/onboarding/turn/route.test.ts` (pre-existing) mocks
  `getOrCreateSession`/`handleOnboardingTurn` entirely and asserts nothing about `modules`, so no
  changes were needed there; it still passes.
- `cd web && npx vitest run lib/onboarding/handleTurn.test.ts app/api/onboarding/turn/route.test.ts`
  → **2 files, 23 tests, all green** (19 in handleTurn.test.ts incl. 4 new; 4 in route.test.ts).
- `cd web && npx vitest run` (full suite) → **91 files, 788 tests, all green**.
- `cd web && npx tsc --noEmit` → clean, no output.
- No pre-existing assertion in `handleTurn.test.ts` was removed or weakened — diff is purely
  additive except for the one-line `modules: {}` default added to the `baseSession()` fixture
  builder (required because `SessionSnapshot.modules` is now non-optional).

## Files changed

- `/Users/jarvis/dev/jarvis/jobify-wt/v3a-b2-llm/web/lib/onboarding/handleTurn.ts`
- `/Users/jarvis/dev/jarvis/jobify-wt/v3a-b2-llm/web/lib/onboarding/handleTurn.test.ts`
- `/Users/jarvis/dev/jarvis/jobify-wt/v3a-b2-llm/web/app/api/onboarding/turn/route.ts`

(Note: `.superpowers/sdd/task-2-report.md` and `.superpowers/sdd/task-3-report.md` showed as
modified in `git status` at the start of this session — pre-existing working-tree state from
earlier task sessions on this branch, unrelated to Task 4. Left untouched and unstaged. This
report file itself (`task-4-report.md`) also pre-existed with unrelated content from an earlier
task-numbering scheme (H4 hosted-hunt entry point) — overwritten here with this task's report.)

## Self-review

- Every `saveSession` call site in `handleTurn.ts` now passes `modules`: resume-skip branch, the
  `done` branch, and the `else` branch — confirmed by re-reading the final file.
- The resume-skip branch's `evidence` mark is unconditional: `markModuleComplete(...)` is called
  directly, not inside any `if`/receipt-null check (unlike the main-path calibration/resume marks,
  which do guard on `receipt` being non-null — that guard is intentional there since
  `MODULE_REGISTRY.range.receipt`/`evidence.receipt` can return `null`, but the resume-skip branch
  passes a literal `"built from your answers"` string straight to `markModuleComplete`, which never
  returns null).
- `ModuleKey` union was not touched; no `"targeting"` key was invented; `checkpoint.ts` and
  `incrementalDoc.ts` were not edited.
- Verified via `grep -rln "SessionSnapshot\|handleOnboardingTurn"` that no other call site besides
  `turn/route.ts` (production) and the two test files needed updating.

## Concerns

None. Implementation matches the brief's exact code snippets and constraints; all tests and
typecheck are green.
