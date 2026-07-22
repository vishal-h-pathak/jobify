# Session 58 — INT2-D: Findings D/E fixes + the final gate  (MAIN checkout)

**Model: Sonnet.** Continuation of the INTERVIEW-2 gate (sessions 55-57).
You work directly on local main, which is ~4 commits ahead of origin
(unpushed, deliberate): the INT2 union merge plus commit 928098c (Fixes
A/B/C/D-harness from the prior gate session). Read FIRST:
`web/lib/onboarding/checklist.ts`, `applyToolCalls.ts`, `handleTurn.ts`
(turn_log / no_progress machinery), `web/sim/invariants/monotonicState.ts`,
`web/sim/personas/classifyQuestion.ts`, and the prior session's findings
recap below. Requires `CLAUDE_CODE_OAUTH_TOKEN` in `web/.env.local`
(sim gate makes real Max-token calls, at-API-prices accounting only).

## Findings you are fixing (from the prior gate session, verified live)
- **Finding D**: `identity_name` is required with no skip path. Personas
  that deflect ("Already said.") loop unbounded: every other intent
  resolves, `nextIntentHypothetical` goes null, the engine burns all 25
  turns re-asking / emitting near-duplicate closing text. (Partly harness:
  `classifyQuestion` has no "name" bucket, so no persona can ever answer a
  name question.) Cooperative passes 3/3 — the engine is otherwise sound.
- **Finding E**: MONOTONIC-STATE flags ANY array shrink, but Fix A only
  guards fully-empty overwrites. A non-empty-but-shorter opportunistic
  re-touch (via anything_else on an unrelated turn) still lands and trips
  the invariant. Reproduced on calibration.skills/evidence.

## FIX D (three parts)
1. **Auth-metadata seeding**: at session creation, seed
   `extracted.identity.name` from the authenticated user's Google metadata
   (full_name / name on the auth user object) when present — via the
   normal merge path, so a user correction can override later. The
   known-context dump then contains it and the model CONFIRMS the name in
   passing instead of asking. For real users this makes the no-skip
   scenario unreachable.
2. **Bounded deferral backstop**: any required intent still unsatisfied
   after 3 distinct asking rounds is marked deferred — appended to
   `extracted.deferred_intents[]`, loud console.warn, turn_log entry — and
   stops blocking `isInterviewDone`. A stuck interview ends bounded and
   honest, never loops to the turn cap. NEVER invent placeholder values
   for deferred fields (the sentinel rule stands). Verify buildProfileDoc
   tolerates the field's absence; flag if it doesn't rather than papering
   over it.
3. **Harness**: add a "name" topic bucket to `classifyQuestion` with
   per-persona answers (terse: a curt real name; corrective: gives it,
   then corrects the spelling once). Alex Quinn persona vocabulary.

## FIX E (ownership-aware array merges — replaces Fix A's literal formula)
Mergers receive the turn's target intent. An array update from the field's
OWNING intent (it was that turn's target) replaces when non-empty — it may
legitimately shrink; that is a user correction. An OPPORTUNISTIC update
(any other turn, including anything_else) is fill-only: it lands only when
the stored value is absent/empty and never replaces non-empty data. Update
`monotonicState.ts` to match: an array shrink is a violation UNLESS the
field's owning intent was that turn's target — document in the invariant
file that this is a refinement encoding ownership semantics, not a
weakening. Tests: owning-intent shrink allowed (and invariant-clean);
opportunistic shorter/equal-length update ignored; opportunistic fill of
an absent field still lands.

## THE FINAL GATE
Full suites first (tsc / vitest / build / scrub — pytest untouched unless
you touch python, which you should not). Then: cooperative, corrective,
terse — TWO runs each, real model. Expected: 6/6 PASS, zero
NO-REPEAT / MONOTONIC-STATE / NO-DOUBLE-FALLBACK / PROGRESS failures, no
sentinel values and no unbounded loops in any transcript, deferral firing
only if a persona genuinely never yields a name (with the new "name"
bucket, it shouldn't need to). If a run fails on a NEW structural finding:
report honestly and stop, per house rules — never tune to force a pass.

## Report format
Fix D/E implementation summary + tests; the verdict tables verbatim; total
sim cost; buildProfileDoc deferral-tolerance verification result; commit
hash on local main. Still NO push — the owner pushes after cockpit review.
Do not begin until the owner confirms.
