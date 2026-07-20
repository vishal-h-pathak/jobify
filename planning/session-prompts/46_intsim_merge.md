# Session 46 — INTSIM-MERGE: reconcile feat/intsim with main  (single session)

**Model: Sonnet.** This is a RECONCILIATION session, not a feature build.
`feat/intsim` (the interview sim harness) branched before an intensive
live-fire fix train landed on main; both sides edited the same three files
with COMPLEMENTARY fixes. Your job: merge to a UNION that keeps every fix
from both sides, prove it with the suites, then run ONE real sim persona as
the validation gate. Work on local main; do NOT push (owner pushes after
reviewing your report).

## Context you must read first
- `web/lib/onboarding/handleTurn.ts` on MAIN — carries (dated comments):
  context-aware fallbacks, model re-prompt on question-less turns, loop
  breaker, server-decided completion floor, retry gated on
  text-empty-AND-tools-empty, per-call ledger rows.
- The same file on `feat/intsim` — carries: push-both-usages on the empty
  retry (the ledger half of the same bug main fixed the data half of), and
  additive `fallback_kind` telemetry (console.warn line + return field).
- `web/lib/onboarding/applyToolCalls.ts`: main has record_identity
  merge-not-replace; branch has record_calibration merge-not-replace. Union.
- `web/lib/anthropic/interview.ts`: main has raised caps (8192) +
  stop_reason warn + no "identity" literal; branch has additive `maxTokens`
  exposure on runInterviewTurn/runCalibrationGeneration for the sim's
  TRUNCATION invariant. Union.
- `web/sim/**`: branch-only — take wholesale.
- Tests: union both sides; adapt branch tests written against the OLD retry
  gate (retry now fires only when text AND toolCalls are both empty) to
  main's semantics without weakening what they assert.

## Steps
1. `git merge feat/intsim` on local main; resolve every conflict to the
   UNION described above. No fix from either side may be lost — grep for
   the dated "Live-fire fix"/"Adversarial-review fix"/"INTSIM" comments on
   both sides and verify each survives in the merged file.
2. In the merged handleTurn: when the empty-retry fires, BOTH calls' usage
   must reach the ledger (branch fix) AND the retry must still be gated on
   `toolCalls.length === 0` (main fix). Add/keep a test asserting both.
3. Full verification: web vitest, tsc --noEmit, next build, scrub gate.
4. **The validation gate:** `cd web && npm run sim -- --persona cooperative`
   (credential already in `web/.env.local`; runs on the owner's Max token —
   at-API-prices accounting only, not real spend). Post-merge main carries
   the thinking-disable + forced tool_choice transport fixes, so expected:
   session reaches done in ≤ ~12 turns, ZERO loop_breaker events, zero
   MONOTONIC-STATE/LEDGER failures, TRUNCATION quiet or near-quiet. Include
   the full verdict table in your report verbatim, pass or fail. If it
   FAILS: do not iterate on prompts/transport — report honestly and stop.
5. Commit the merge (+ any test adaptations) on local main with a clear
   message. Do NOT push.

## Exit criteria
All suites green; scrub PASS; both sides' dated fixes verifiably present;
one real cooperative-persona verdict table in the report. Report format:
merge summary (conflicts + resolutions), fix-survival checklist, verdict
table, and anything you judged ambiguous.
