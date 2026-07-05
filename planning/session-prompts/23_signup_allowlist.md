# Session 23 — SGN-1: Friend allowlist — codeless signup  (Hosted wave 9, single session)

**Model: Sonnet.** Decisions are made — implement faithfully.
**Run from:** a `jobify-wt/hosted-sgn1-allowlist` worktree.
**Depends on:** wave 8 (ADM-2) merged to main.
**You own:** `web/app/(app)/admin/**`, `web/lib/admin/**`, `web/app/auth/**`,
`web/app/invite/**`, `web/lib/db/**` (allowlist helper only),
`jobify/migrations/0009_allowed_emails.sql` (new), docs, tests. Off-limits:
`jobify/` Python, `dashboard/`, migrations 0001–0008, `web/components/ui/**`,
onboarding/feed/settings pages.

---

## Product change (decided)

Friends shouldn't need to receive an invite code out of band. The operator
adds a friend's EMAIL in the admin panel; when that person first signs in
(magic link), the system auto-mints and auto-claims an invite for them and
routes them straight to onboarding. Everyone else keeps the existing
invite-code flow — the gate still gates. Manual codes keep working unchanged.

## Tasks

1. **Migration `0009_allowed_emails.sql`** (additive, idempotent, house
   conventions): `allowed_emails` — `email TEXT PRIMARY KEY` (store
   lowercased; enforce with a `CHECK (email = lower(email))`),
   `note TEXT` (operator's label, e.g. a first name — optional),
   `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `consumed_by UUID
   REFERENCES auth.users (id) ON DELETE SET NULL`, `consumed_at
   TIMESTAMPTZ`. RLS enabled, NO policies — service-role only (this table
   holds third-party PII; users never read it, not even their own row).
   Header note: emails of people who haven't consented to an account live
   here — keep it minimal (email + optional short note), delete rows freely.
2. **Auto-claim hook** — in the auth callback's post-session logic (the
   spot that currently decides `/invite` vs `/feed` vs `/admin`): if the
   user has NO claimed invite, service-role-check `allowed_emails` for
   `lower(user.email)` with `consumed_by IS NULL`. On hit, atomically-ish:
   mint one invite (reuse the existing generator; `created_by` NULL is
   fine), claim it for the user (service-role update — NOT the user-facing
   `claim_invite` RPC, to avoid its auth context), mark the allowlist row
   consumed, then route to `/onboarding`. Factor as
   `web/lib/db/allowlist.ts::consumeAllowlistedEmail(admin, user)` (pure-ish,
   injected client, unit-testable). Failure anywhere → log + fall through
   to the normal `/invite` routing (never a dead end, never a 500 on the
   callback). Re-login of an already-consumed user follows the normal
   claimed-invite path untouched.
3. **Admin panel — "Friends" card** (on the Operations tab): add-email form
   (validate shape, lowercase before insert; optional note field), list
   (email, note, added, status: "waiting" / "signed up <date>"), remove
   button per row (service-role delete; removing after consumption is
   allowed and harmless — their claimed invite stands). All through
   `/api/admin/allowlist` routes guarded by `requireAdmin()` exactly like
   the existing admin routes (service-role only after the gate).
4. **Copy touch:** the `/invite` page gains one secondary line — "Invited by
   email? Just sign in with that address — no code needed." Landing page
   beta note likewise softened ("you'll need an invite" stays true — don't
   over-explain the mechanism there).
5. **docs/OPERATIONS.md:** "Inviting friends" section rewritten: primary
   path = add email in admin panel → tell them to sign in; code minting
   demoted to fallback. Note the PII posture of `allowed_emails`.

## Tests

Allowlist consume: hit (mints + claims + consumes + routes onboarding),
miss (normal /invite routing), already-consumed (normal routing), failure
mid-sequence falls through safely, email matching is case-insensitive,
consumed rows never re-consumed. Admin routes: 401/403 matrix, add
lowercases + validates, remove works. Callback routing matrix updated
(admin → /admin unchanged; allowlisted → /onboarding; neither → /invite).
All fakes, repo patterns, no live network.

## Exit criteria

- Full web vitest + tsc + `npm run build` green; Python suite untouched and
  green; scrub gate PASS (no real emails anywhere — tests use
  friend@example.com).
- `git diff` respects ownership; 0001–0008 untouched.
- Commit: `SGN-1: friend email allowlist — codeless signup (auto-mint+claim on first login) + admin Friends card`.
- Push; do NOT merge — review-then-merge. Reviewer close-out: 0009 to live
  DB + `vercel --prod`.
