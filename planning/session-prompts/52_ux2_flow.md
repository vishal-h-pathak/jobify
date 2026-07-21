# Session 52 — UX-2: auth flow, hunt-button truth, U2 copy fixes  (worktree `feat/ux2`)

**Model: Sonnet.** Inputs: `planning/FEEDBACK_U2_2026-07-21.md` (read FIRST —
items 1/3/8 + the card-corpus addendum are this session's scope; items 4-7
are INTERVIEW-2, do NOT band-aid them here). Everything this session is
web-only. No migrations, no python.

## Constitutional rules
1. `bash scripts/scrub_gate.sh` PASS. No operator strings; the admin email
   exists only in the ADMIN_EMAILS env; fixtures use Alex Quinn.
2. No LLM calls added. No schema changes.
3. Commit on `feat/ux2`; no push, no merge.

## Part 1 — Auth/invite routing (live bug, top priority)
Reported: opening the site in a fresh browser lands on the "enter invite
code" screen BEFORE any sign-in is offered — but invite claims are
account-level (allowed_emails / hasClaimedInvite), so an already-onboarded
user on a new device should just sign in and pass.
- Trace the actual routing (middleware/layouts/invite page) and restructure:
  unauthenticated visitor → /login, always, on every entry path. The
  invite-code screen appears only AFTER auth, only for accounts with no
  claim and no allowed_emails row and not admin.
- Verify the claim check is purely server/DB-side — if ANY part of "has
  access" is browser-local (cookie/localStorage beyond the Supabase session
  itself), move it to the account and report what you found.
- Tests: unauthenticated → login redirect for /, /feed, /onboarding;
  authed+claimed (fresh session, no prior cookies) → straight through;
  authed+unclaimed → invite screen.

## Part 2 — Run Hunt button tells the truth
Today the button's state is client-local: navigate away and back and it's
clickable again mid-run (double-dispatch risk). Derive state server-side on
feed load:
- **in progress**: profiles.last_hunt_requested_at within the last ~30 min
  AND no hunt_cycles row finished after it → render a non-clickable
  "Hunt in progress…" indicator (started HH:MM).
- **cooldown**: last completed cycle within HUNT_COOLDOWN_HOURS → disabled
  with a "next hunt available in ~Xh" note.
- **error**: newest cycle after the request has counters.first_error whose
  text begins with the user's uuid prefix → show "last hunt hit an error"
  with a retry affordance (best-effort — hunt_cycles has no user_id column;
  do not add one).
- Ready otherwise. Tests for all four derivations (pure function over
  (profile, cycles) inputs + a component test).

## Part 3 — U2 copy fixes (FEEDBACK doc items 1, 3, 8)
- "Years in role" → label it as exactly what it feeds ("years in your
  current role"); if the field actually means total experience, fix the
  label to say that instead — check what the extraction stores.
- Trajectory options get one-line concrete examples under each (switch
  ladders: "IC → PM, agency → in-house"; experimenting: "not committing to
  one direction yet — show me range"; etc.).
- Kill "this is the fence" and sweep ALL intake-facing copy for insider
  jargon (fence, ladder/rungs, fossilized, spine, receipts-as-jargon) —
  plain language a first-time non-engineer understands. List every string
  you changed in the report.

## Part 4 — Mirror corpus includes card answers (FEEDBACK doc addendum)
The verbatim-quote filter (`filterVerbatim` in the mirror generate route)
builds its corpus from chat messages only — U2 answered mostly via
structured cards, so her real phrases weren't in the corpus and good quotes
got dropped. Extend the corpus (additively — never remove message text) to
include the user-authored text held in `session.extracted` (card free-text,
choices' custom text, energy answers, range statement). Pure-function
`buildVerbatimCorpus(session)` + tests: card-only session yields a corpus
containing its phrases; the mirror route uses it.

## Verification
`cd web && npx tsc --noEmit && npx vitest run && npm run build`; scrub gate.
Aim ≤~600 lines. Cut order if timeboxed: Part 3 copy sweep breadth first,
never Parts 1-2.

## Report format
Per-part status/files/tests; the routing you found and what moved
server-side (Part 1's verification finding explicitly); every copy string
changed; suite results verbatim; scrub PASS. Do not begin until the owner
confirms.
