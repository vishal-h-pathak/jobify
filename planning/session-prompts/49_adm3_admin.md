# Session 49 — ADM-3: admin panel + onboarding auto-seed hook  (worktree `feat/adm3`)

**Model: Sonnet. TIMEBOXED: the owner invites his first external user in ~1-2
hours.** Functional beats pretty everywhere. Branch from post-merge main
(HUNT2 wave A is merged: matches has status/reject_reason/location_tier;
board_catalog + portals seeding exist).

## Constitutional rules (non-negotiable)
1. `bash scripts/scrub_gate.sh` must PASS. CRITICAL THIS SESSION: the admin
   email contains a scrubbed identifier substring, so it must NEVER appear in
   code, tests, fixtures, or comments. Admin gating reads a comma-separated
   `ADMIN_EMAILS` env var (server-side only, set in Vercel by the owner).
   Tests use fixture emails (alex.quinn@example.com etc.).
2. NO schema changes, NO migrations this session — everything reads existing
   tables (budget_ledger, allowed_emails, profiles, hunt_cycles, matches,
   onboarding session/state tables, board_catalog).
3. All admin data access is server-side with the service-role client. Nothing
   about one user may leak to another user's browser; admin pages/API routes
   verify `isAdmin(sessionEmail)` server-side on EVERY request, not just in
   the UI.
4. No LLM calls. Commit on `feat/adm3`; do not push, do not merge.

## Part 0 — Onboarding completion auto-seed hook (do this FIRST)
Session 48 built portals seeding but flagged the hook unwired: in
`web/lib/onboarding/handleTurn.ts`, the `if (done)` block builds/upserts the
profile doc but never seeds portals. Fix:
- Refactor the core of `web/scripts/reseedPortals.ts` into a callable
  `seedUserPortals(userId)` in `web/lib/profile/portalsSeed.ts` (or sibling),
  keeping the script as a thin wrapper. MERGE-NOT-REPLACE semantics preserved.
- Call it from the `if (done)` path AFTER the profile doc upsert. It must be
  fail-open: a seeding error logs loudly but NEVER fails the user's final
  onboarding turn (wrap, catch, console.error).
- Test: completion turn triggers seeding once; seeding throw does not break
  the turn's response.

## Part 1 — Admin gating
- Find the existing admin mechanism (grep `web/lib/admin/`, `web/app/` for
  how systemMetrics/users pages are currently gated) and CONSOLIDATE into one
  `isAdmin(email: string | null): boolean` in `web/lib/admin/isAdmin.ts`,
  driven by `ADMIN_EMAILS` (comma-separated, case-insensitive, trimmed).
  Empty/unset env = nobody is admin (fail closed).
- Every admin page and admin API route goes through it server-side. Non-admin
  hit = 404 (not 403 — don't advertise the panel's existence).
- Report what the pre-existing gating was.

## Part 2 — Admin dashboard (`/admin`, server components)
Sections, in priority order — if the timebox bites, cut from the bottom:
1. **Spend** — from budget_ledger (at-API-prices framing, label it so):
   all-time total; per-user totals; per-verb breakdown (interview,
   calibration, extractors, mirror, hunt verdict, etc. — use the ledger's
   actual verb/kind values); last-14-days daily totals (plain table or
   minimal inline bars — no chart library).
2. **Users & invites** — allowed_emails rows (email, note, created_at,
   consumed_by/consumed_at status badge) joined where consumed to: profile
   stage, onboarding completed_at, last-activity timestamp, matches surfaced
   count. Plus an **add-invite form** (email + note) posting to an
   admin-gated route that inserts into allowed_emails.
3. **Onboarding behavior (per user)** — stage, turn count, fallback/loop
   telemetry counts (fallback_kind landed with the INTSIM merge), per-module
   budget consumption vs caps, done/not.
4. **Hunt & feed (per user)** — recent hunt_cycles with counters (including
   the new boards_total/fetched/skipped_empty), matches funnel by status
   (rejected_title/…/surfaced) and location_tier distribution of surfaced.
5. **Admin actions** — beyond add-invite: a **reset-module-budget** button
   (user + module) hitting an admin-gated route (this un-sticks the
   mirror-regeneration failure mode the owner hit live). Both actions
   server-validated, no client trust.
Layout: match the site's existing styling primitives; single page with
sections is fine; no new dependencies.

## Verification
`cd web && npx tsc --noEmit && npx vitest run && npm run build`; scrub gate.
Tests: isAdmin edge cases (unset env, case, whitespace), gated route returns
404 for non-admin, invite insert, budget reset, Part 0's two tests. Aim
≤~600 lines; if the timebox forces cuts, cut dashboard sections 4→3, never
Part 0, gating, or scrub compliance.

## Report format
Part 0 hook status + tests; pre-existing gating found + what consolidated;
sections shipped vs cut; routes added; suite results verbatim; scrub PASS;
env vars the owner must set in Vercel (ADMIN_EMAILS) called out explicitly.
Do not begin until the owner confirms.
