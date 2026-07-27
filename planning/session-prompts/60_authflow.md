# Session 60 — AUTHFLOW: one routing rule, every path, forever  (worktree `feat/authflow`)

**Model: Sonnet.** Live evidence (owner, today): opening
`https://jobify-swart.vercel.app/admin` in a signed-out browser (Safari)
lands on the ENTER-INVITE-CODE screen. Session 52 fixed `/`, `/feed`,
`/onboarding` — but the rule was applied per-path instead of universally,
and `/admin` (and possibly other paths: `/tailor/*`, `/submit/*`,
`/profile`, `/settings`, API-initiated redirects) leak to the invite wall
or 404 when the real state is simply "not signed in yet."

## THE RULE (implement it in ONE place, not per-page)
For every non-public path:
1. **Unauthenticated** → redirect to `/login?next=<original path+query>`.
   Never the invite screen. Never a 404. No exceptions — including
   `/admin` (admin-existence secrecy applies to AUTHENTICATED non-admins,
   who still get 404; an anonymous visitor learns nothing from a login
   redirect since every path gives the same one).
2. **Authenticated + hasAccess** → the requested page. After login,
   `next` is honored (sanitized: same-origin relative paths only) so the
   user lands where they were going — including through the Google OAuth
   round-trip (thread `next` through the auth callback; the historical
   bug lived exactly in that callback's `next` branches, so add tests on
   BOTH branches).
3. **Authenticated, no access** → `/invite` (the only door to the invite
   screen). Claiming/allowlist auto-claim then honors `next`.
4. Public paths: `/` (anon pitch), `/login`, `/invite` (auth-gated
   internally per rule 3), auth callback, static assets.

Implementation guidance (verify against the real code, don't assume):
Next.js middleware is the natural single enforcement point for rules 1-2's
redirect; keep per-route `requireAdmin`/`hasAccess` checks as the
authorization layer (defense in depth — middleware handles
AUTHENTICATION routing only, so no service-role or DB calls in
middleware; a lightweight session-presence check via the Supabase cookie
helpers is sufficient there). If a middleware already exists, extend it;
if the (app) layout redirect from session 52 becomes redundant, keep it
as the belt-and-suspenders layer but make the middleware authoritative.

## Acceptance matrix (each one becomes a test; the report lists all)
| Start state | URL opened | Must land on |
|---|---|---|
| signed out | /admin | /login → (after Google) /admin |
| signed out | /feed | /login → /feed |
| signed out | /tailor/abc | /login → /tailor/abc |
| signed out | /submit/setup | /login → /submit/setup |
| signed out | / | anon pitch page (unchanged) |
| signed in, admin | /admin | /admin |
| signed in, non-admin w/ access | /admin | 404 |
| signed in, no access | /feed | /invite, then /feed after claim |
| signed out | /login?next=https://evil.com | next rejected → default landing |

## Also in scope (small, related)
- Declare `@next/env` explicitly in web/package.json (devDependencies) —
  kills the recurring fresh-worktree `npm run build` resolution ghost that
  has hit three sessions.
- Grep for any remaining hardcoded redirect to `/invite` outside rule 3's
  single door; each one found gets replaced with the rule and listed in
  the report.

## Constitutional
Scrub PASS; Alex Quinn fixtures; no migrations; no LLM calls; commit on
`feat/authflow`, no push/merge. Verification: web tsc/vitest/build (build
should now pass even in this fresh worktree, proving the @next/env fix),
scrub. Aim ≤~400 lines.

## Report
The enforcement point chosen (middleware vs layout) with rationale; the
full acceptance matrix as automated tests (names); every hardcoded
/invite redirect found+removed; the auth-callback `next` handling on both
branches; suites verbatim. Do not begin until the owner confirms.
