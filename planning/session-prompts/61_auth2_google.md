# Session 61 — AUTH-2: one-click Google sign-in + visible identity  (worktree `feat/auth2`)

**Model: Sonnet.** The Supabase Google provider is ENABLED and configured
(owner did the dashboard work; redirect URI
`https://vujlecpmurismvnjebcf.supabase.co/auth/v1/callback`). Context: every
existing account is a magic-link email identity, and the accumulated UX
damage (per-browser email round-trips, invisible account confusion — the
owner spent an hour walled out of his own admin panel because Safari held
his OTHER Google account's session) is the motivation. Session 60's routing
rule (signed-out → /login?next=…; invite has one door) is live — build ON
it, change none of it.

## Constitutional rules
Scrub PASS; Alex Quinn fixtures; no migrations; no LLM; commit on
`feat/auth2`, no push/merge.

## The work

### 1. "Continue with Google" — the primary sign-in
- LoginForm: a prominent "Continue with Google" button calling
  `supabase.auth.signInWithOAuth({ provider: "google", options: {
  redirectTo: <origin>/auth/callback?next=<sanitized next> } })` — `next`
  threads through the OAuth round-trip using the existing `sanitizeNext`,
  landing exactly per session 60's rule.
- Magic link DEMOTED to secondary: "or, get a sign-in link by email" below.
- **CRITICAL — identity linking:** existing users are email-provider
  identities. Verify (Supabase docs + the project's auth config) that a
  Google sign-in with a matching verified email LINKS to the existing user
  rather than minting a new one — a duplicate user would orphan every
  existing profile. State in your report exactly what guarantees this
  (config setting/doc citation). If anything is ambiguous, make the report
  say so LOUDLY so the owner tests with his own account before anyone else
  uses it.

### 2. Magic-link fallback polish
Proper sent-state ("Link sent to <email> — check your inbox", with the
email shown), resend with a visible cooldown, error surfacing (rate limit,
invalid email), and the emailed link honoring `next` end-to-end.

### 3. Visible identity, everywhere it matters
- The invite wall gains: "Signed in as <email> — not you? **Switch
  account**" (switch = sign out + redirect to /login preserving next).
  This one line would have saved the owner's hour today.
- /login when ALREADY authenticated: instead of a silent bounce, show
  "You're signed in as <email>" with [Continue] (per session-60 default
  routing) and [Use a different account].
- A sign-out affordance reachable from every gated state, including
  no-access (the invite wall's switch-account covers that path).

### 4. Tests
Extend the session-60 acceptance matrix: OAuth initiation carries sanitized
next; oauth callback → original target; invite wall renders the session
email + switch flow signs out and lands on /login with next intact; login
authed-state branch. Keep all 60's tests green untouched.

## Verification
web tsc / vitest / build; scrub. Aim ≤~450 lines. Report: files/tests, the
identity-linking guarantee with citation, screenshots-in-words of the three
states (login signed-out, login signed-in, invite wall), suites verbatim.
Do not begin until the owner confirms.

## Post-merge acceptance (owner, in the report as a checklist)
1. Fresh Safari → site → Continue with Google → pick vshlpthk1 → lands
   signed in ON THE SAME PROFILE (feed/dossier present — proves linking).
2. Invite wall (thak.io account) shows "Signed in as …" + switch works.
3. Magic-link fallback still works for an email-only test.
