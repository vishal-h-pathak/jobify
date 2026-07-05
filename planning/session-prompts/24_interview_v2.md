# Session 24 — INT-1: Interview v2 — resume-first, pointed questions  (parallel-safe, single session)

**Model: Sonnet.** The interview design is fully decided — encode it exactly.
**Run from:** a `jobify-wt/hosted-int1-interview` worktree (branch off main).
**Parallel-safe with:** ADM-2 (22) and SGN-1 (23). **You own:**
`web/lib/anthropic/interview.ts` (+test), `web/lib/onboarding/**`,
`web/app/(app)/onboarding/**` (seeded opener text, progress-rail labels,
copy only), `web/scripts/gen-h3-fixture.ts` + `tests/fixtures/h3_profile_doc.json`
+ `tests/test_h3_onboarding_doc_fixture.py` (regenerate as needed). Do NOT
touch `web/app/(app)/admin/**`, `web/app/auth/**`, `web/app/invite/**`,
`web/lib/admin/**`, `jobify/hosted/**`, migrations, `web/components/ui/**`.

---

## Why (owner feedback, 2026-07-05)

The current flow asks open-ended interest questions BEFORE the resume ("what
kind of work actually sounds fun") — the owner's word for the failure mode is
"woo woo." Redesign: resume first, then a small number of POINTED questions
generated as deltas against the resume, each mapped to a field the scorer
consumes.

## Hard constraints (unchanged from UX-3 — do not violate)

- `onboarding_sessions.stage` enum untouched (`resume`/`identity`/
  `targeting`/`done`); change what happens inside stages + UI labels only.
- PII minimization unchanged (no work-auth/sponsorship/start-date/address;
  email from auth; phone/LinkedIn optional-only).
- One `budget_ledger` row per LLM turn via the existing `handleTurn` path;
  the seeded opener costs zero LLM calls.
- Final `profiles.doc` passes the TS validator and the Python fixture
  cross-check (regenerate the fixture with the script; keep its
  source-data header honest).

## The interview (decided — encode in the system prompt + stage logic)

**Tone rules (put a literal ban-list in the system prompt):** direct, second
person, no exclamation marks, never use: passion, dream, journey, fulfilling,
"lights you up", calling, purpose. Questions must be answerable in one short
message. Never ask anything the resume already answers.

**Stage 'resume' —**
1. Seeded opener (no LLM, rendered instantly): "Welcome. Paste your resume
   (or upload a .txt/.md) and we'll get through this fast — a few pointed
   questions after, about five minutes total."
2. On resume receipt: extract, then REFLECT BACK a compact summary (current/
   last role, years, 3–4 core skills, location if present) ending with "—
   anything wrong or missing?" One correction turn max.

**Stage 'identity' —** ONE batched logistics turn (not four): confirm/ask
name if unclear from resume, then: "Logistics, all in one go: where are you
based, remote-only or is some onsite fine (and where), and what's the salary
floor below which you won't even look?" Optional phone/LinkedIn only if the
user volunteers; never prompt for them.

**Stage 'targeting' —** exactly these, each ONE turn, each grounded in the
actual resume content:
1. **Direction (forced choice with derived options):** propose 2–3 concrete
   next-role directions derived FROM their background — "More of <what they
   do>, a senior version of it, or adjacent — e.g. <derived option A> or
   <derived option B>? Pick, combine, or correct." Answers → tiers.
2. **Trade-off (rubric gold):** "Two postings, same title: <context-apt
   contrast derived from their field — e.g. small startup vs large org,
   clinic vs hospital system, agency vs in-house>. Which ranks higher for
   you, or genuinely no preference?" → term-group weights / thesis energy.
3. **More-of / done-with:** "From your last role at <employer>: name one
   thing you want more of, and one you're done with." → thesis energy
   signals, phrased as work activities not feelings.
4. **Dealbreakers, bluntly:** "Anything I should never show you — industries,
   company types, work setups?" → disqualifiers.yml.
5. **Optional seed:** "Any specific companies you'd want on the watchlist?
   Fine to skip." → portals.yml seeding (skippable without follow-up).

**Stage 'done' —** plain-words profile summary (what we'll rank up, what we'll
never show, logistics one-liner) + the existing CTA to the feed and the
"hunts run when you ask" line.

**Progress rail relabel:** Resume → Basics → What you want → Done (4 labels;
drop the old 5-label "About you" mapping).

## Tests

System prompt contains: the ban-list, the reflect-back instruction, the
batched-logistics instruction, all five targeting questions' instructions,
and NO pre-resume interest questions (assert the old opener text is gone).
Seeded opener renders without an API call and asks for the resume. Ledger
row per turn unchanged. Fixture regenerated + Python cross-check green.
Existing resilience behaviors (retry banner, draft preservation, resumable
session, .txt/.md-only upload) still covered by their tests.

## Exit criteria

- `npm run build`, `npx vitest run`, `npx tsc --noEmit` green; scrub gate
  PASS; `python -m pytest tests/test_h3_onboarding_doc_fixture.py -q` green
  from repo root.
- `git diff` stays inside your file list (nothing under admin/auth/invite/
  hosted/migrations).
- Commit: `INT-1: resume-first interview — reflect-back + five pointed targeting questions, ban-list tone`.
- Push; do NOT merge — review-then-merge.
