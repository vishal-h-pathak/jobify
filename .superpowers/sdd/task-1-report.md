# Task 1 — INT-1: resume-first interview redesign — report

## What I implemented

### `web/lib/anthropic/interview.ts`

- **`SEEDED_GREETING`**: replaced the old "what do you do, and what kind of
  work actually sounds fun right now?" opener with the resume-first ask:
  "Welcome. Paste your resume (or upload a .txt/.md) and we'll get through
  this fast — a few pointed questions after, about five minutes total."
  (verbatim, per brief).
- **`INTERVIEW_SYSTEM_PROMPT`**: rewritten.
  - Deleted stage "0. OPENING" entirely — no pre-resume interest exchange.
  - Added a literal tone ban-list ("passion", "dream", "journey",
    "fulfilling", "lights you up", "calling", "purpose"), no exclamation
    marks, one-short-message-answerable questions.
  - Stage 1 (RESUME INGESTION): states there is no pre-resume exchange,
    then REFLECT BACK a compact summary (current/last role, years,
    3-4 core skills, location if present) ending with the exact string
    "— anything wrong or missing?", bounded to one correction turn max.
  - Stage 2 (IDENTITY & LOGISTICS): ONE batched logistics turn with the
    exact wording from the brief ("Logistics, all in one go: where are you
    based, remote-only or is some onsite fine (and where), and what's the
    salary floor below which you won't even look?"); name confirmed/asked
    only if unclear from resume; phone/LinkedIn/website/GitHub explicitly
    volunteer-only, never asked; CRITICAL RULE (work authorization, visa
    sponsorship, start date, relocation/in-person-for-forms, AI-policy,
    prior interviews) preserved and still asserted by tests.
  - Stage 3 (TARGETING): exactly five questions, one per turn, each with
    the field it feeds spelled out (tiers / thesis_summary / thesis_summary
    / hard_disqualifiers / dream_companies), using the brief's exact
    question wording (direction, trade-off, more-of/done-with,
    dealbreakers, optional companies seed).
  - Wrap-up: unchanged CTA string `Head to your feed and hit "Run my hunt"
    to get your first results.` (HNT-1 pin, untouched).
  - `INTERVIEW_TOOLS`, `ExtractedState`-adjacent types, `applyToolCalls`
    stage-transition logic — **not touched** (verified below).
- Updated the doc-comments above both exports to reflect the new design
  and cross-reference (INT-1, 2026-07-05).

### `web/lib/anthropic/interview.test.ts`

Fully rewritten with 18 tests covering: SEEDED_GREETING exact text + "no
'sounds fun'"; old opener/OPENING-stage/interest-follow-up gone; ban-list
words literally present; no-exclamation-marks + one-short-message rule;
reflect-back instruction + exact correction question + one-correction-max;
batched-logistics exact wording + volunteer-only phone/LinkedIn/etc;
CRITICAL RULE (work authorization/visa/start date/AI-policy/prior
interviews) still forbidden; all five targeting questions' instructions
(direction/tiers, trade-off/thesis_summary, more-of-done-with/thesis
energy, dealbreakers/hard_disqualifiers, optional seed/dream_companies);
and the exact `Head to your feed and hit "Run my hunt"` CTA string.

### `web/app/(app)/onboarding/page.tsx`

- `RAIL_LABELS` changed from the 5-label `["About you", "Resume", "Basics",
  "Targeting", "Done"]` to the 4-label `["Resume", "Basics", "What you
  want", "Done"]`.
- `computeRailSteps` simplified: dropped the `assistantMessageCount`
  parameter (the message-count heuristic that split `resume` into two rail
  states is gone, since there's no longer a pre-resume interest exchange to
  represent). New signature: `computeRailSteps(stage: InterviewStage):
  RailStep[]`, doing a direct 1:1 index lookup via a `STAGE_ORDER` array
  (`resume`→0, `identity`→1, `targeting`→2, `done`→3).
- Updated the one call site in `OnboardingPage` (dropped the now-unused
  `assistantMessageCount` local and the second argument).

### `web/app/(app)/onboarding/page.test.tsx`

- Rewrote the `computeRailSteps` describe block for the 4-label direct
  mapping (4 tests: resume/identity/targeting/done).
- Rewrote the `OnboardingView — progress rail active label per state`
  `it.each` block to the 4 stage→label pairs (dropped
  `assistantMessageCount` from the table).
- Updated the `fetchInitialState` "restores a resumed session" test's rail
  assertions to check "What you want" (was "Targeting").
- Updated all remaining `computeRailSteps(state.stage, 1)` call sites (3 of
  them, in the failed-turn / rejected-upload / OnboardingView-greeting
  tests) to the new single-argument signature.
- Left the resilience tests (seeded-greeting rendering/dedup,
  retry-preserves-draft, upload accept/reject, resumed-session restore)
  behaviorally untouched — only touched where the `computeRailSteps` call
  signature rippled in.
- Lightly reworded one stale comment (referenced the now-removed
  message-count rail heuristic) in the "regression: seeded greeting still
  displayed" test; the assertion itself (assistantCount === 2) is
  unchanged.

## Verified NOT changed (per brief's hard constraints)

- `web/lib/onboarding/handleTurn.ts` and `applyToolCalls.ts` — read both in
  full; stage-transition logic (`record_resume`→identity,
  `record_identity`→targeting, `finish_interview`→done) is untouched and
  needed zero changes. Their test files were not touched.
- `web/lib/profile/buildDoc.ts` / `ExtractedState` — not touched.
- `INTERVIEW_TOOLS` schema — not touched (still the same 4 tools/fields).

## Tests run

- `npx vitest run` (from `web/`): **38 test files, 233 tests, all passed**,
  clean output, no stray warnings.
- `npx tsc --noEmit` (from `web/`): clean, no output.
- `npm run build` (from `web/`): succeeded — `✓ Compiled successfully`,
  `✓ Generating static pages using 9 workers (11/11)`.
- `bash scripts/scrub_gate.sh` (repo root): `scrub gate: PASS` (both the
  identifier scan and the binary-document scan passed).
- `npx tsx web/scripts/gen-h3-fixture.ts` then `git diff --stat --
  tests/fixtures/h3_profile_doc.json` (repo root): **no diff** — confirms
  `ExtractedState`/`buildProfileDoc` truly weren't touched.
- `python -m pytest tests/test_h3_onboarding_doc_fixture.py -q` (repo root,
  in a scratch venv since none was pre-provisioned in this worktree):
  `1 passed`.

## Files changed

- `web/lib/anthropic/interview.ts`
- `web/lib/anthropic/interview.test.ts`
- `web/app/(app)/onboarding/page.tsx`
- `web/app/(app)/onboarding/page.test.tsx`

`git diff --stat` against pre-task HEAD (`7e3d635`) touches exactly these
4 files — nothing under `admin/`, `auth/`, `invite/`, `lib/admin/`,
`jobify/hosted/`, migrations, or `components/ui/`.

## Self-review findings

- All ban-list words, reflect-back, batched-logistics, all five targeting
  questions, gone-old-opener, and the 4-label rail were implemented and are
  each independently asserted by a test that checks the actual exported
  string constants (not vacuous checks — verified by first dumping the
  real computed `INTERVIEW_SYSTEM_PROMPT` string via a throwaway vitest
  test and copying exact substrings into the assertions, rather than
  hand-reconstructing template-literal line-continuation joins by eye).
- No issues found requiring further fixes.

## Concerns

- `node_modules` was not installed in this worktree checkout; I ran
  `npm install` in `web/` to run the verification commands. This did not
  modify `package.json`/`package-lock.json` (verified via `git status`).
  No Python venv existed either; I created a throwaway one in the
  scratchpad dir to run the pytest check — nothing related to it was
  committed.
- This report file (`.superpowers/sdd/task-1-report.md`) previously
  contained unrelated content from a different task ("Foundational infra
  for H4 (hosted worker)") — I overwrote it with this task's report per
  the instructions to write the report to this exact path. Flagging in
  case that prior content needs to be preserved/relocated elsewhere.

## Fix: email wiring

Task review on the INT-1 commit (`eaef33b`) caught a closed-loop break:
removing the old "ask for email in chat" instruction (per the plan's
"email from auth" line) left nothing actually forwarding the
authenticated user's real email into `record_identity` — the model would
have had to fabricate a value for a still-required schema field. Fix
brief: `.superpowers/sdd/task-1-fix-brief.md`. Human decision: make the
real auth email authoritative, overwriting whatever (if anything) the
model supplies, unconditionally, every turn.

### What I implemented

1. **`web/lib/onboarding/handleTurn.ts`** — added `userEmail: string` to
   `HandleTurnDeps`. After `applyToolCalls` produces `extracted`, if
   `extracted.identity` exists, its `email` field is overwritten with
   `userEmail` unconditionally (`extracted.identity = { ...extracted.identity,
   email: userEmail }`), before the `extractedForStorage` widen/persist.
   This runs every turn `identity` is present — including turns where
   `record_identity` fired in a *prior* turn and this turn's tool calls
   don't touch it — so the auth email always wins, whether the model
   omitted email, echoed it correctly, or fabricated a completely
   different one.
2. **`web/app/api/onboarding/turn/route.ts`** (approved exception to the
   owned-file list) — now passes `userEmail: user.email ?? ""` into the
   `handleOnboardingTurn({...})` call, sourced from the already-fetched
   `supabase.auth.getUser()` result.
3. **`web/lib/anthropic/interview.ts`** — relaxed `record_identity`'s
   `input_schema.required` from `["name", "email"]` to `["name"]`. `email`
   remains a valid optional property on the schema (harmless if the model
   includes one, since step 1 overwrites it regardless). No system prompt
   wording changes — the batched-logistics instruction already correctly
   omits asking for email.

### Tests updated/added

- `web/lib/onboarding/handleTurn.test.ts`: added `userEmail` to every
  existing `handleOnboardingTurn(...)` call (now a required field), plus a
  new test — "overwrites a model-supplied (bogus) record_identity email
  with deps.userEmail, unconditionally" — that has the mocked model return
  a tool call with a deliberately bogus email
  (`totally-made-up@nowhere.invalid`), asserts the bogus string genuinely
  reached `runTurn`'s history (so the test can't pass by accident), and
  then asserts the `saveSession` payload's `extracted.identity.email` is
  the auth email (`real-auth-email@example.com`) and explicitly is **not**
  the bogus one. This is stronger than the pre-existing "omitted email"
  coverage implicit elsewhere — it proves overwrite-wins-even-when-supplied,
  not just fill-in-when-absent.
- `web/app/api/onboarding/turn/route.test.ts`: added `email:
  "user-1@example.com"` to the "succeeds with a claimed invite" test's
  `getUserMock` fixture (which previously omitted email), and added an
  assertion that `handleOnboardingTurnMock` was called with
  `expect.objectContaining({ userEmail: "user-1@example.com" })`.
- `web/lib/anthropic/interview.test.ts`: added a new describe block
  asserting `INTERVIEW_TOOLS.find(t => t.name === "record_identity")
  .input_schema.required` equals `["name"]` (not `["name", "email"]`), and
  that `email` is still present as an optional schema property.

### Verification

- `npx vitest run` (from `web/`): **38 test files, 236 tests, all passed**
  (233 pre-existing + 1 new in `handleTurn.test.ts` + 2 new in
  `interview.test.ts`), pristine output.
- `npx tsc --noEmit` (from `web/`): clean after one fix — the new
  `handleTurn.test.ts` test's `runTurn` mock initially had no declared
  parameter, so TS inferred `Parameters<typeof runTurn>` as `[]` and
  `runTurn.mock.calls[0][0]` came back `undefined`/out-of-bounds; typed the
  mock as `async (_history: ChatMessage[]) => ...` to match the pattern
  already used by the other history-asserting tests in that file.
- `bash scripts/scrub_gate.sh` (repo root): `scrub gate: PASS` — both the
  identifier scan and binary-document scan passed; no new strings
  introduced by this fix trip it.

### Self-review

- All 4 required changes from the fix brief are implemented exactly as
  specified: `handleTurn.ts` deps + unconditional overwrite,
  `route.ts` wiring, `interview.ts` schema relaxation, and all three
  named test files updated.
- The new `handleTurn.test.ts` test specifically proves the
  overwrite-wins-even-when-the-model-supplied-a-bogus-value case (not just
  the omitted-email case) by asserting both on the bogus value actually
  reaching `runTurn`'s history and on the auth email being what ultimately
  lands in the `saveSession` payload.
- File scope respected: only the 4 code/test files named in the brief
  plus the one approved-exception route file/its test were touched; no
  other files under `admin/`, `auth/`, `invite/`, `jobify/hosted/`, or
  migrations were touched.
- No concerns beyond what's already flagged above (task-1's own report
  content having been uncommitted at fix-brief handoff time — folded into
  this same commit since amending `eaef33b` is out of scope).
