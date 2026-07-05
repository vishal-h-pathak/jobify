# Session 25 — FIX-1: Interview turns must always ask the next question  (single session, high priority)

**Model: Sonnet.** This fixes a bug observed in a live user session — the
evidence transcript is below; make the behavior impossible, don't just nudge
the prompt.
**Run from:** a `jobify-wt/hosted-fix1-interview` worktree off main.
**You own:** `web/lib/anthropic/interview.ts` (+test),
`web/lib/onboarding/handleTurn.ts` (+test),
`web/app/(app)/onboarding/**` (only if a UI guard is needed). Do NOT touch
admin/auth/invite/hosted/migrations/ui-components.

---

## The bug (live user, 2026-07-05 — real transcript)

INT-1's terseness/ban-list rules overcorrected: the model acknowledges and
advances the stage but STOPS ASKING QUESTIONS. Actual assistant turns from a
real onboarding, in order:

1. (reflect-back of resume) "...— anything wrong or missing?"  ✓ good
2. user: "This is good." → assistant: **"Good, moving on."**  ✗ no question
3. user: "ok" → assistant: **""** (empty, 0 chars — billed a turn, said nothing)  ✗
4. user: (volunteered location/remote/comp) → assistant: **"Got it — locked in."**  ✗ no question
5. user: "Go ahead" → assistant: **"Before I log this — what's your name?"**  ✗✗ asked for the NAME that was on her resume (violates "never ask what the resume answers")
6. user: "Samantha Jones. This was on my resume." → assistant: **"Apologies — got it, Samantha."**  ✗ no question

Net: five assistant turns, zero substantive questions asked; the user had to
drag the interview forward with "ok" / "go ahead". Three distinct defects:
(A) turns end without a question, (B) turns come back empty, (C) it asked for
resume-known info (name).

## Required fixes

1. **Every non-terminal assistant turn MUST end with exactly one question.**
   Put this as a hard, unmissable rule in the system prompt (not a soft
   preference): until stage is `done`, the assistant's message always ends
   with the single next question. Acknowledgment is allowed ONLY as a short
   clause before that question ("Got it — <question>"), never as the whole
   message. Explicitly forbid standalone "moving on" / "locked in" / "got it"
   turns.
2. **Empty-response guard in `handleTurn.ts`:** if the model returns
   empty/whitespace-only assistant text, do NOT persist a blank turn or show
   a blank bubble. Retry the completion once; if still empty, fall back to a
   deterministic stage-appropriate question (a small per-stage constant map —
   the batched-logistics question for `identity`, the first unanswered
   targeting question for `targeting`, etc.) so the user always sees a
   question. Log when this fires. (The turn was still billed — that's
   acceptable, but the user must never see nothing.)
3. **Never ask for resume-known fields.** Strengthen the prompt: name,
   current/last role, employer, education, skills, and location-if-present
   come from the resume extraction — the assistant must use them, never ask
   for them. If a genuinely needed field is missing from the resume, ask for
   THAT specific field only.
4. **Stage-transition turns keep asking.** The defect clusters at stage
   boundaries (resume→identity, identity→targeting): when logic advances the
   stage, the SAME assistant message that acknowledges the prior answer must
   already pose the new stage's first question. Make the stage instructions
   explicit that advancing ≠ a free "moving on" turn.

## Tests

- Assert the system prompt contains the always-end-with-a-question rule and
  the never-ask-resume-fields rule, and forbids bare acknowledgments.
- `handleTurn` empty-response path: model returns "" → retry → still "" →
  deterministic fallback question surfaces (assert non-empty, stage-apt),
  and a blank turn is never written to `messages`.
- A stage-transition turn (fake model output that only acknowledges) is
  caught/repaired rather than shown — OR, if you enforce purely via prompt,
  add a post-check in handleTurn that appends the fallback question when the
  assistant text has no "?" and stage != done. Prefer the post-check: it's
  deterministic and can't regress on a prompt tweak.
- Ledger row per turn unchanged; fixture cross-check still green.

## Exit criteria

- web vitest + tsc + build green; scrub gate PASS; python fixture test green.
- `git diff` inside the owned files only.
- Commit: `FIX-1: interview always ends turns with a question; empty-response guard; never re-ask resume fields`.
- Push; do NOT merge — review-then-merge.
