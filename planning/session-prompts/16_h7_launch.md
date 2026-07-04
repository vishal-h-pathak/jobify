# Session 16 — H7: Wrap-ups + beta hardening + launch  (Hosted wave 4, single session)

**Run from:** a `jobify-wt/hosted-h7-launch` worktree.
**Depends on:** waves 1–3 merged to main (H1–H6, migrations 0001–0006 applied to
live project `vujlecpmurismvnjebcf`).
**Parallel-safe with:** nothing — you have the whole repo this wave. The
pipeline status machine (`jobify/shared/status.py`), `jobify/tailor/`,
`jobify/submit/`, and `dashboard/` remain off-limits as always.

**Structure: two parts with a HARD STOP between them.** Part A is code —
commit/push/stop for review-then-merge like every prior session. Part B is
operations (deploy, secrets, smoke) — begins ONLY after Vishal confirms the
merge landed. Several steps in Part B are human gates: STOP and ask rather
than working around them.

---

## Context

Read `planning/HOSTED_AGGREGATOR_PLAN.md` (§6 H7 row), `docs/COST_RAILS.md`,
`docs/SCORING.md`, `web/README.md`. Everything is built; this session makes it
real: friends get invite codes, the web app runs on Vercel, the hunter runs on
cron, and Vishal can see what it's all costing.

## Part A — code (review-then-merge)

1. **Typed Database follow-up (parked from H5):** add `matches` and
   `postings` Row/Insert/Update blocks to `web/lib/supabase/types.ts`
   (types must mirror 0002+0006 columns EXACTLY — the wave-2 lesson; note
   `matches.state` values come from `jobify/shared/match_state.json`).
   Retype `FeedSupabaseClient` to `SupabaseClient<Database>` in
   `web/lib/db/matches.ts` and delete the local casts there and in
   `web/app/(app)/feed/page.tsx` / `MatchCard.tsx`.
2. **Defense-in-depth on feed transitions (review smell):** add explicit
   `.eq("user_id", ...)` scoping to the four single-row transitions and
   `markSeenBulk` in `web/lib/db/matches.ts`. RLS remains the boundary;
   this makes a 0-rows error unambiguous.
3. **Invite minting:** `jobify-hosted-invite` console script
   (`pyproject.toml` + `jobify/hosted/invites.py`) — service-role;
   `--mint N` generates N unguessable codes (`secrets.token_urlsafe(9)`,
   lowercase), inserts, prints them; `--list` shows codes with
   claimed_by/claimed_at. Tests with the fake-client pattern.
4. **Cycle telemetry:** at the end of each `jobify-hosted-hunt` cycle, send
   the one-line summary (users scored, postings upserted, matches written,
   stage-4 calls, pool spend MTD vs cap) via ntfy (`NTFY_TOPIC` env,
   POST-to-topic pattern — mirror `jobify.notify`'s style). Env-gated:
   unset topic = skip silently. Include the summary line in logs regardless.
5. **Enable the cron:** uncomment/add the `schedule:` trigger in
   `.github/workflows/hosted-hunt.yml` (daily, pick a UTC hour ~06:00
   America/New_York), keep `workflow_dispatch`. Document required repo
   secrets in the workflow header AND in the ops runbook (task 6):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
   `JOBIFY_KEY_ENCRYPTION_SECRET`, embedding-provider key (per
   `docs/SCORING.md`'s H4 decision), `NTFY_TOPIC` (optional),
   `HOSTED_GLOBAL_MONTHLY_CAP_USD` (optional override).
6. **Ops runbook:** `docs/OPERATIONS.md` — env/secret inventory (GHA vs
   Vercel vs local, one table); minting + distributing invites; the
   `JOBIFY_KEY_ENCRYPTION_SECRET` mint command (`openssl rand -base64 32`)
   + rotation policy (link COST_RAILS.md); admin SQL snippets (pool spend
   MTD by user, matches per user, invite status, `validation_status`
   errors); "friend can't get in" triage checklist.
7. **Housekeeping:** delete the stray empty `web/__tests__/` dir if present;
   add a regeneration script or npm script for
   `tests/fixtures/h3_profile_doc.json` (the fixture-drift review note).

**Part A exit criteria:** full Python suite + web vitest + `tsc --noEmit` +
`npm run build` green; commit
`H7a: typed feed client, invite minting, cycle telemetry, cron + ops runbook`;
push the branch; **STOP — do not merge, do not begin Part B.** Report and wait.

## Part B — operations (only after Vishal confirms the merge)

Work from main after the merge. Every step that needs a credential or a
dashboard click is a HUMAN GATE — ask, wait, verify, move on.

1. **Secrets inventory** [GATE]: have Vishal supply/mint: the live project's
   anon + service-role keys (Supabase dashboard → project
   `vujlecpmurismvnjebcf` → API), `ANTHROPIC_API_KEY` (the funded pool key),
   the embedding key, and mint `JOBIFY_KEY_ENCRYPTION_SECRET` fresh. Never
   echo full secrets back into the transcript; confirm by last4.
2. **Vercel deploy** [GATE for login/scope]: create the Vercel project from
   `web/` (`vercel` CLI; root directory `web/`), set env vars
   (`NEXT_PUBLIC_SUPABASE_URL=https://vujlecpmurismvnjebcf.supabase.co`,
   anon key, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
   `JOBIFY_KEY_ENCRYPTION_SECRET`), deploy, record the prod URL in
   docs/OPERATIONS.md (commit that small doc update to main directly).
3. **Supabase auth config** [GATE — dashboard]: walk Vishal through setting
   Site URL to the Vercel prod URL + adding it (and localhost:3000) to the
   magic-link redirect allowlist. Without this, magic links bounce.
4. **GHA secrets + cron** : set the repo secrets from step 1 (`gh secret
   set`, values piped not pasted into argv), then `workflow_dispatch` one
   hosted-hunt run and watch it to green (`gh run watch`).
5. **End-to-end smoke** [GATE — Vishal is the test user]: mint one invite;
   Vishal signs in on the prod URL with a magic link, claims it, runs the
   onboarding chat for real, then trigger one more hunt cycle and confirm
   his feed populates with scored matches and reasons; check `budget_ledger`
   rows landed for his onboarding + verdicts and the ntfy ping arrived.
6. **Close out:** update docs/OPERATIONS.md with anything learned in the
   smoke; report: prod URL, cron schedule, spend after smoke, invite codes
   remaining, and any rough edges for the friends-launch note.

## Hard rules carried over

- Never commit a secret; `.env*` stays gitignored (and remember the
  `/profile/` anchor — don't "fix" it back).
- The system never auto-sets `applied`; nothing in ops changes that.
- BYO plaintext keys must never appear in logs or the transcript.
- Review-then-merge for ALL code, including Part B doc touches beyond the
  trivial URL/runbook updates called out above.
