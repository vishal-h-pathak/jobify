# Session 20 — ADM-1: Admin panel  (Hosted wave 6, single session)

**Model: Sonnet.** All security decisions are made below — implement exactly;
do not invent alternative auth schemes.
**Run from:** a `jobify-wt/hosted-adm1-panel` worktree.
**Depends on:** wave 5 merged (UX-1/2/3 on main).
**You own:** `web/app/(app)/admin/**` (new), `web/app/api/admin/**` (new),
`web/lib/admin/**` (new), `web/app/(app)/layout.tsx` (nav link only), and the
two invite-gate guard call sites listed in task 2. Do NOT touch `jobify/`
(Python), migrations, `web/components/ui/**`, feed/settings/onboarding pages.

---

## Security model (decided — the only acceptable design)

- **Admin = signed-in user whose email is in the `ADMIN_EMAILS` env var**
  (comma-separated, compared case-insensitively after trim). Server-side
  ONLY: `web/lib/admin/isAdmin.ts` takes the Supabase `user` object and
  reads `process.env.ADMIN_EMAILS`. There is no admin flag in the DB, no
  client-side secret, and NO email literal anywhere in code or tests (the
  CI scrub gate forbids the operator's domain — use `admin@example.com` in
  tests via env stubbing).
- **Every `/api/admin/*` route:** `getUser()` → 401 if none → `isAdmin` →
  403 if not. Only THEN may the route construct the service-role client.
  The service-role client must never be created before the admin check.
- **Admins bypass the invite gate** (an admin may not have claimed a code):
  in the `(app)` layout gate and in the onboarding API-route guards, the
  check becomes `hasClaimedInvite || isAdmin`. Touch nothing else about
  those guards.
- **The nav "Admin" link renders only for admins** (server component check)
  — but the pages/routes never rely on link-hiding for security.
- `/admin` for a non-admin: redirect to `/feed`. Signed-out: to `/login`.

## Panel scope (v1 — three cards on one page, `/admin`)

1. **Invites** — table of all codes (code, created_at, claimed_by email or
   "unclaimed", claimed_at), newest first; a "Mint invite" button (and a
   small N selector, 1/3/5) hitting `POST /api/admin/invites`. Code
   generation must match the Python CLI's shape: 12 chars, lowercase
   base64url (`crypto.randomBytes(9).toString("base64url").toLowerCase()`).
   Freshly minted codes render prominently with a copy-to-clipboard button
   and the full invite link (`https://<host>/invite?code=<code>` built from
   the request origin, not hardcoded).
2. **Users** — one row per `profiles` row: email (via service-role
   `auth.admin.listUsers()` mapped by id), onboarding/validation status
   (from `validation_status`), match counts by state (single grouped
   query), spend MTD, BYO key yes/no (existence only — never the
   ciphertext, never key_last4 here).
3. **Pool health** — postings count + newest `last_seen_at`, pool spend MTD
   vs `HOSTED_GLOBAL_MONTHLY_CAP_USD` (progress bar, amber), spend split
   pool vs BYO. Read-only. (No trigger-hunt button in v1 — that needs a
   GitHub token; note it as a deliberate omission in the page footer,
   "hunts run daily on cron".)

All UI with the existing `ui/` primitives, matching the app shell; data
fetched server-side in the page component through the same admin-guard
helper (factor `requireAdmin()` used by both the page and the API routes).

## Tests

Env-stubbed (`ADMIN_EMAILS=admin@example.com`): isAdmin matrix (exact,
case-insensitive, multi-email list, unset env → NOBODY is admin, empty
string entries ignored); route guards (401 signed-out, 403 non-admin,
service-role never constructed pre-check — assert via fake factory call
order); mint endpoint shape (12-char lowercase base64url, N respected,
rows inserted via service-role fake); invite-gate bypass (admin without
claim passes layout + onboarding guards; non-admin without claim still
403s). Follow the repo's fake patterns; no live network.

## Exit criteria

- `npm run build`, `npx vitest run`, `npx tsc --noEmit` green; no new deps;
  `bash scripts/scrub_gate.sh` PASS (no operator email/domain anywhere).
- `.env.example` (web) gains `ADMIN_EMAILS` with a comment; docs/OPERATIONS.md
  gains an "Admin panel" section (env var on Vercel; admins bypass invite
  gate; minting from the UI vs the CLI).
- `git diff --stat` stays inside your file list.
- Commit: `ADM-1: env-driven admin (requireAdmin) + /admin panel — invites, users, pool health`.
- Push; do NOT merge — review-then-merge.
