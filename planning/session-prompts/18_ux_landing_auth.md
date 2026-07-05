# Session 18 — UX-2: Landing page + auth flow  (Hosted wave 5b)

**Model: Sonnet.** The design decisions are made — implement faithfully.
**Run from:** a `jobify-wt/hosted-ux2-landing` worktree.
**Depends on:** UX-1 (17) merged to main — use its `web/components/ui/`
primitives and tokens everywhere; do not restyle or fork them.
**Parallel-safe with:** UX-3 (19). **You own:** `web/app/page.tsx` (landing),
`web/app/login/**`, `web/app/invite/**`, `web/app/auth/**`,
`web/lib/supabase/updateSession.ts` (only if the redirect chain needs it),
their tests. Do NOT touch `web/app/(app)/**`, `web/lib/anthropic/**`,
`web/lib/onboarding/**`, `web/components/ui/**`, `jobify/`.

---

## Why

Live-smoke findings (2026-07-04): visiting `/invite` signed-out dead-ends at a
red "not signed in" — the user has no idea login comes first. And `/` gives a
first-time visitor nothing. Friends will hit both within 30 seconds.

## The flow (decided)

An invited friend gets a link `https://<host>/invite?code=<code>`. From there,
every path must funnel correctly with zero dead ends:

1. `/` (landing) — welcoming, explains the thing in one screen, one primary
   CTA: "I have an invite" → `/invite` (and a quiet "Sign in" ghost link for
   returning users → `/login`).
2. `/invite` signed-OUT → redirect to `/login?next=/invite?code=<code>`
   (preserve the code through the whole chain). No red error — the redirect
   IS the fix.
3. `/login` — email + magic-link send, honoring `?next=`: pass it through the
   auth callback so the user lands back on `/invite?code=…` after clicking
   the email link. Keep the callback's same-origin-relative guard for `next`
   (it exists — extend it to carry querystrings, still rejecting absolute/`//`).
4. `/invite` signed-IN — code input PRE-FILLED from `?code=`, one click to
   claim, then straight to `/onboarding`. Already-claimed users who visit
   again → redirect to `/feed`.
5. Post-magic-link default (no `next`) → `/invite` if no claimed invite,
   `/feed` if claimed.

## Tasks

1. **Landing** (`/`): jobify wordmark large; headline "a job feed that
   actually knows you"; three short lines on how it works (interview → a
   daily feed scored against what you actually want → reasons, not keyword
   soup); honest beta note ("private beta — you'll need an invite from the
   person who sent you here"); the two CTAs. All `ui/` primitives, tone per
   the UX-1 spec (warm, no exclamation marks). Signed-in visitors with a
   claimed invite get redirected to `/feed` instead of seeing the pitch.
2. **The redirect chain** exactly as specced, incl. the magic-link email
   round-trip. Preserve `?code=` end-to-end (URL-encode it in `next`).
3. **Login page polish:** single card — "Sign in with your email. No
   password — we send you a link."; sent-state swaps the card for a
   check-your-inbox message with the email shown; resend allowed after 30s.
4. **Invite page polish:** card with the pre-filled code, claim button with
   busy state, and on 409 (invalid/used code) a `Banner` explaining it might
   be claimed already — with a "ask for another code" secondary line. On
   success, brief "You're in." state then router push to `/onboarding`.
5. **Tests:** redirect chain unit tests (signed-out /invite preserves code
   through login; callback rejects `//evil` and absolute URLs but carries
   `/invite?code=x`); claim flow states (prefill, busy, 409, success);
   landing redirect for claimed users. Follow existing fake patterns.

## Exit criteria

- `npm run build`, `npx vitest run`, `npx tsc --noEmit` green; no new deps;
  `bash scripts/scrub_gate.sh` passes.
- Manually walk the flow against a local `supabase start` if available; if
  not, note it and rely on the unit tests (the merge review runs the live
  pass).
- `git diff --stat` stays inside your file list.
- Commit: `UX-2: landing page + invite-first auth funnel (code-preserving redirect chain)`.
- Push; do NOT merge — review-then-merge.
