# Session 19 — UX-3: Conversational onboarding  (Hosted wave 5b)

**Model: Sonnet.** Design + conversation decisions are made — implement
faithfully.
**Run from:** a `jobify-wt/hosted-ux3-onboarding` worktree.
**Depends on:** UX-1 (17) merged — use its `web/components/ui/` primitives.
**Parallel-safe with:** UX-2 (18). **You own:**
`web/app/(app)/onboarding/**`, `web/lib/anthropic/interview.ts`,
`web/lib/onboarding/**`, their tests. Do NOT touch `web/app/page.tsx`,
`web/app/login/**`, `web/app/invite/**`, `web/app/auth/**`,
`web/components/ui/**`, `web/app/(app)/feed/**`, `jobify/`, migrations.

---

## Why

Screenshot review (2026-07-04): onboarding opens on a giant empty box that
says "paste your resume" — cold, transactional, and the model never asks who
the person is. Owner's requirement, verbatim in spirit: *the model should ask
about the user, the things they're interested in, and request an up-to-date
resume* — conversation first, paperwork second.

## Hard constraints (do not violate)

- `onboarding_sessions.stage` CHECK is `('resume','identity','targeting',
  'done')` — you may change what HAPPENS inside stages and their UI labels,
  but NOT the enum values (no migrations from this session).
- PII-minimization stands: never ask for work authorization, sponsorship,
  start dates, or full address. Email comes from auth. Phone/LinkedIn stay
  optional-only.
- Every LLM turn still writes its `budget_ledger` row via the existing
  `handleTurn` path — do not bypass it.
- The final `profiles.doc` must still pass the TS validator AND the Python
  cross-check fixture flow (`web/scripts/gen-h3-fixture.ts` — if your
  conversation changes what `extracted` looks like, regenerate the fixture
  with that script and keep `tests/test_h3_onboarding_doc_fixture.py` green;
  its source-data note explains exactly how).

## The conversation (decided — encode in `interview.ts`'s system prompt + stage logic)

- **Opening (stage 'resume', before any resume exists):** the assistant
  speaks FIRST — a seeded greeting rendered instantly on page load (no LLM
  call needed for it): "Hey — welcome. I'm going to build your job-hunting
  profile with you. Before the paperwork: what do you do, and what kind of
  work actually sounds fun right now?" The user answers in prose; the model
  follows up ONCE on interests/energy (what they'd love more of, what
  they're done with), THEN asks for the resume: "Now the boring part — paste
  your resume or upload a .txt/.md file and I'll pull the facts from it."
  Everything learned pre-resume feeds `thesis.md`'s energy-signals section.
- **Stages 'identity' and 'targeting'** keep their extraction contracts but
  the questions must be conversational, one topic per turn, reflecting back
  what it heard ("Atlanta, remote-first, floor around $130k — here's what
  I've got so far…") instead of form-like interrogation.
- **Wrap ('done'):** short summary of the built profile in plain words +
  "Your feed starts filling on the next hunt cycle — usually within a day."
  CTA button to `/feed`.

## Tasks

1. **Chat UI rebuild** (`onboarding/` page): real conversation layout —
   assistant/user bubbles (assistant on surface cards, user in amber-tinted
   bubbles right-aligned), auto-scroll, Enter-to-send + Shift-Enter newline,
   `ui/FileButton` for upload, typing indicator (3-dot pulse) while the turn
   is in flight, disabled composer during flight. A slim progress rail:
   About you → Resume → Basics → Targeting → Done (map the 4 stage values +
   pre-resume opening onto these 5 labels).
2. **Seeded opening + interview prompt changes** per the spec above; the
   follow-up-once rule and ask-for-resume transition live in the system
   prompt/stage instructions, and the seeded greeting is injected into the
   rendered transcript (and into `messages` on first user reply so the model
   has it as context — without a phantom extra LLM call).
3. **Resilience polish:** error banner w/ retry on failed turn (message not
   lost — composer repopulates), resumable-session behavior verified in UI
   (reload mid-interview restores transcript + stage), upload rejects
   non-.txt/.md with a friendly line.
4. **Tests:** seeded greeting renders without an API call; one-follow-up-
   then-resume-request encoded in the prompt (assert the system prompt
   contains the staged instructions); ledger row per turn unchanged; failed
   turn preserves draft; fixture pipeline still green (regenerate if
   `extracted` gained interest fields — keep additions OPTIONAL in the doc
   builder so minimal profiles still validate).

## Exit criteria

- `npm run build`, `npx vitest run`, `npx tsc --noEmit` green; no new deps;
  scrub gate passes; python fixture test green (run
  `python -m pytest tests/test_h3_onboarding_doc_fixture.py -q` from repo
  root).
- `git diff --stat` stays inside your file list.
- Commit: `UX-3: conversational onboarding — seeded greeting, interests-first interview, chat UI`.
- Push; do NOT merge — review-then-merge.
