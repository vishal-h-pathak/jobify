# Session 55 — INT2-A: the server-driven interview engine  (worktree `feat/int2-engine`)

**Model: Sonnet.** This is the INTERVIEW-2 redesign — the structural fix for
every interview failure this product has had. Read FIRST:
`planning/FEEDBACK_U2_2026-07-21.md` (items 4-7 are the live evidence),
`web/sim/**` (the harness + invariants you must keep green), and the current
`web/lib/onboarding/handleTurn.ts` + `web/lib/anthropic/interview.ts` (the
architecture you are RETIRING — its dated fix comments are a map of the
failure modes the new engine must make structurally impossible).

## The verdict you are implementing
The adversarial review's conclusion, confirmed live twice: **"the server
treats stochastic model output as control flow."** Completion, stage
advancement, repetition-avoidance, and fallbacks all currently depend on
what the model happens to emit. INT2 inverts it: the SERVER owns all
control flow; the model's only jobs are (a) phrasing the next question and
(b) extracting fields from the answer.

## The engine contract (pinned — deviations need cockpit sign-off)
1. **Checklist, not stages.** A static `INTERVIEW_CHECKLIST`: ordered field
   specs `{key, extractedPath, module, intent, required, askHint}` covering
   everything the profile build needs (derive the set from what buildDoc +
   the rubric compiler actually consume — not from the old stage machine).
   Each extracted field is owned by EXACTLY ONE intent (this kills the
   energy/trajectory double-ask — U2 item 6). `missingFields(extracted)`
   is a pure function; `done ⇔ no required field missing` — the server
   decides, always (generalizes the old completion floor).
2. **Every model call is a forced tool call.** One tool,
   `interview_turn`, with input schema:
   `{question: string, extracted_updates: {...}}` — the user-facing
   question is a FIELD of the forced tool. There are ZERO unforced
   interview calls in the new engine, which eliminates the OAuth
   invisible-thinking empty-turn failure mode BY CONSTRUCTION (it only
   ever bit unforced calls). max_tokens 4096; stop_reason warn on cap.
3. **The server picks the target.** Each turn: compute missing → target =
   the first missing required intent (batch up to 3 related intents from
   the same module into one question when natural). The prompt tells the
   model WHAT to ask (intent + askHint + relevant extracted context so it
   never re-asks what's known — U2 items 4/5/7 die here); the model
   decides only HOW to phrase it.
4. **No canned strings as control flow.** Delete LOOP_BREAKER_QUESTION,
   TARGETING_DIRECTION_FALLBACK, the v2 re-prompt nudge, and every
   fallback that appends fixed text. Failure handling: if a turn returns
   an empty/invalid question → ONE retry (both calls ledgered, both
   usages recorded — preserve the F1 fix semantics) → then a
   deterministic question rendered from the target intent's askHint
   (context-derived template, not a global canned string). A turn can
   never loop: asking the same intent twice in a row with no new
   extraction forces the askHint path.
5. **Extraction preserved, merge-not-replace.** Keep applyToolCalls'
   merge semantics (field-present-and-nonempty wins, deep-merge). The
   `extracted_updates` schema is the union of the target intents' fields
   plus an `anything_else` opportunistic-capture object routed through
   the same merge.
6. **Recovery is free.** State = extracted + turn log, persisted every
   turn (existing session save). Resume from any interruption =
   recompute missing. No resume-specific code paths beyond a greeting.
7. **Telemetry persisted, not inferred.** Append per-turn to
   `session.extracted.turn_log[]`: `{intent_keys, retry_used,
   askhint_fallback_used, input_tokens, output_tokens, ts}`. The admin
   expander's text-scanning fallback counts (ADM-3 caveat) switch to
   reading this.
8. **Keep intact:** budget_ledger row per call, module-progress receipts
   (map checklist intents → modules so the progress UI works unchanged),
   the dedicated module routes (voice/metrics/mirror/reactions are NOT
   this session's surface), scrub gate, Alex Quinn fixtures.

## Collision avoidance (session 56 runs in parallel)
YOURS: `web/lib/onboarding/handleTurn.ts` (rewrite),
`web/lib/anthropic/interview.ts` (rewrite), new
`web/lib/onboarding/checklist.ts` + `intentRegistry.ts`,
`applyToolCalls.ts`, `/api/onboarding/turn`, their tests, and the sim
harness's engine-facing seams if signatures change (keep persona/invariant
code intact).
NOT YOURS: `web/app/api/onboarding/modules/**` (all module routes),
`moduleTurns.ts`, reactions deck anything, admin pages.

## Verification
tsc / vitest / build / scrub. DO NOT run live sim personas — that's
session 57's gate, on the merged result. Your tests must cover: missing→
done logic, single-ownership of fields (a test that fails if two intents
claim one path), never-ask-filled, the retry→askHint ladder, telemetry
shape, merge semantics preserved. Aim ≤~800 lines; this is the one session
allowed to run large — completeness beats thrift here.

## Report format
Engine contract compliance point-by-point (1-8); the full checklist as
implemented (every intent + fields); what was deleted (list each retired
fallback/constant); suites verbatim; scrub; ambiguities. Do not begin
until the owner confirms.
