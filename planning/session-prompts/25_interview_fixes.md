# Session 25 — INT-2: Interview transition + empty-reply fixes  (single session)

**Model: Sonnet.** Two bugs observed LIVE during the 2026-07-05 friend test —
both diagnosed from the prod transcript; fix exactly these.
**Run from:** a `jobify-wt/hosted-int2-fixes` worktree (branch off main).
**You own:** `web/lib/anthropic/interview.ts`, `web/lib/onboarding/handleTurn.ts`,
their tests, `web/app/(app)/onboarding/**` (copy only if needed). Nothing else.

---

## The two live bugs

1. **Stage transitions drop the question.** At every stage boundary the model
   replied with a bare acknowledgment and stopped — observed verbatim: "Good,
   moving on." (resume→identity) and "Got it — locked in." (identity→
   targeting). The user had to type "ok" to unstick each time.
2. **Turns can be completely empty.** One turn returned zero-length assistant
   text (LLM call ran and billed, no tool call recorded, nothing rendered) —
   the user stared at a blank bubble.

## Fixes (decided)

1. **Prompt rule — every turn ends with a question:** add a hard, prominent
   instruction to the system prompt: until the interview reaches its wrap,
   EVERY assistant message must end with exactly one question. Stage
   transitions must combine the brief acknowledgment AND the next stage's
   first question in the same message ("Got it. Now: where are you based,
   …?"). Never send an acknowledgment-only message.
2. **Code guard — empty/questionless replies never reach the user:** in
   `handleTurn`, after a turn (and after the email overwrite), if the
   assistant text is empty/whitespace: retry the LLM call ONCE (same input;
   this is a second billed turn — still write both ledger rows honestly).
   If the retry is also empty, substitute a deterministic fallback: a
   per-stage canned question (write one for each stage — logistics batch,
   first targeting question, etc.) so the user always has something to
   answer. Log a warning either way. Do NOT retry non-empty answers that
   merely lack a question — the prompt rule handles those; a heuristic
   question-detector would misfire.

## Tests

Prompt: assert the always-end-with-a-question rule text + the combined
transition instruction exist. handleTurn: empty reply → exactly one retry +
second ledger row; double-empty → stage-appropriate fallback question
returned + warning logged; non-empty replies never retried; existing email-
overwrite and ledger tests untouched and green.

## Exit criteria

- `npm run build`, `npx vitest run`, `npx tsc --noEmit`, scrub gate all green;
  Python fixture cross-check still green (regen only if extraction shapes
  changed — they shouldn't).
- Commit: `INT-2: transitions must ask; empty-reply retry + per-stage fallback questions`.
- Push; do NOT merge — review-then-merge. Close-out: `vercel --prod` (no
  migration).
