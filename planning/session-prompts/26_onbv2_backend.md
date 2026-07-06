# Session 26 — ONB-A: Interview v2 backend  (Onboarding-v2 wave 1, parallel with ONB-C)

**Model: Sonnet.** The full spec is `planning/ONBOARDING_REDESIGN.md` §2 (flow,
stage machine, prompts, contracts, budget) — read it FIRST and implement it
exactly; this prompt only pins ownership, the owner's decisions, and tests.
**Run from:** a `jobify-wt/hosted-onbv2-backend` worktree off main.
**You own:** `web/lib/anthropic/interview.ts`, `web/lib/onboarding/**`,
`web/lib/profile/buildDoc.ts`, `web/app/api/onboarding/**` (incl. new anchor
route), `jobify/migrations/0010_onboarding_stage_v2.sql`, their tests, the
fixture regen. Do NOT touch `web/app/(app)/**` UI, `web/components/**`,
`web/app/(auth)/**`, admin/settings routes, migrations 0001–0009.

## Owner decisions binding this session (2026-07-05, supersede the doc's open questions)

1. **No-title users:** the anchor form's escape path accepts free text ("describe
   your situation"). The calibration GENERATION prompt must handle it: e.g. a
   student → junior-level calibration anchored on internships/coursework/interests
   mentioned in the free text. No separate path — one flexible anchor.
2. **Extraction visibility:** no user-facing extraction editor. (Admin review is
   session ONB-D's — you just keep `extracted` complete and well-shaped, it is
   the review surface's source.)
3. **Post-skip resume upload is allowed later:** implement the reusable core here —
   `web/lib/profile/regenerateCv.ts`: given an existing profiles row + new resume
   text, re-run resume extraction and rewrite ONLY `cv.md` (+ refreshed
   background_summary if trivially derivable), preserving every other doc file.
   Update `buildDoc.ts`'s "code never overwrites" header to document this single
   sanctioned exception. (The settings UI wiring is ONB-D's; ship the helper +
   tests only.)
4. **Targeting questions are FULLY GENERATED, 3–5, real-time-contextual:** no
   fixed wording. The system prompt instructs the model to derive each question
   from everything known so far (anchor + calibration + resume-if-any) and skip
   anything already answered. The five INT-1 archetypes (direction, trade-off,
   more-of/done-with, dealbreakers, company seed) become a COVERAGE CHECKLIST —
   the required `record_targeting` fields (tiers, disqualifiers, thesis signals)
   must still all be populated; generation freedom never excuses a missing field.
5. **No grandfathering:** nobody is onboarded; migration step 2 (identity→
   targeting remap) ships anyway for safety, and the reviewer wipes test
   sessions at deploy.

## Hard requirements (from §2 — violations are review-blockers)

- Anchor = zero LLM calls, zero ledger rows; every other LLM turn = exactly one
  ledger row.
- Calibration: exactly 4 generated prompts per §2's four probes; the model
  NEVER evaluates/grades/praises answers; "describe the shape, not the secrets"
  employer-confidentiality line in the prompt.
- Resume stage skippable via explicit skip (not empty send); skip → synthesized
  `cv.md` with the provenance header per §2.
- FIX-1 behaviors preserved structurally: deterministic no-question post-check +
  empty-reply retry-once, fallback map extended to ALL new stages; never re-ask
  anchor/resume-known fields; auth email overwrite unconditional.
- PII bans unchanged. Tone ban-list unchanged. Final doc validates (schema +
  Python fixture cross-check — regenerate the fixture for the v2 flow and keep
  its source-data header honest).
- Migration 0010 exactly as §2 pins it (additive, idempotent, keeps 'resume'
  legal, default 'anchor').

## Exit criteria

Full web vitest + tsc + `npm run build` green; Python suite + fixture test
green from repo root; scrub gate PASS; diff inside ownership.
Commit: `ONB-A: interview v2 backend — anchor/calibration stages, optional resume, generated targeting, 0010`.
Push; do NOT merge. Reviewer close-out: 0010 live + session-B/D unblock.
