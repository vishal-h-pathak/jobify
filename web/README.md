# jobify web — hosted onboarding + feed (v1)

A separate Next.js app from `dashboard/` on purpose: `dashboard/` is the
single-user local cockpit (`DASHBOARD_PASSWORD`, filesystem `profile/`).
This app is the hosted, multi-user product surface — Supabase Auth magic
links, per-user profile rows, invite-gated sign-up. See
`planning/HOSTED_AGGREGATOR_PLAN.md` for the full shape.

**v1 scope**: sign-in → invite gate → onboarding chat (produces a valid
`profiles.doc`) → feed (scored `matches`×`postings`, grouped New/Saved/
Applied/Dismissed, save/dismiss/"I applied"/undo, profile-health banner).

## No live Supabase project yet

Infra hosting decision is deferred. Everything here runs against a local
`supabase start` stack.

## Local dev

1. From a directory with a Supabase CLI project (or init one), apply the
   schema in order:
   ```bash
   supabase start
   supabase db execute --file ../jobify/migrations/0001_init.sql
   supabase db execute --file ../jobify/migrations/0002_multitenant.sql
   supabase db execute --file ../jobify/migrations/0003_hosted_onboarding.sql
   supabase db execute --file ../jobify/migrations/0004_worker.sql
   supabase db execute --file ../jobify/migrations/0005_invite_claim_fn.sql
   ```
   (0002 creates `matches`/`postings` — the feed's tables; 0004 adds the
   `validation_status` column the profile-health banner reads.)
   (paths relative to wherever your Supabase CLI project lives — adjust
   accordingly. See `jobify/migrations/README.md`.)
2. `supabase status` for the local URL + anon + service_role keys.
3. `cp .env.example .env.local` and fill in those three, plus
   `ANTHROPIC_API_KEY`.
4. Mint yourself an invite code (service-role only — there's no UI for
   this in v1):
   ```sql
   insert into public.invites (code) values ('test-invite-1');
   ```
5. `npm install && npm run dev`, then visit `http://localhost:3000`.

## Env vars

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | local stack: `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | `supabase status` → anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes, server-only | used ONLY for the per-turn `budget_ledger` insert (`lib/supabase/admin.ts`) |
| `ANTHROPIC_API_KEY` | yes, server-only | onboarding chat's only LLM call |
| `ONBOARDING_CLAUDE_MODEL` | no | defaults to `claude-sonnet-5` |

## Flow

```
/            landing, links to /login
/login       Supabase magic link (signInWithOtp)
/auth/callback   exchanges the magic-link code for a session
/invite      enter an invite code; claims it via a conditional UPDATE
             (0003's invites_claim_unclaimed RLS policy) — zero rows
             updated means invalid or already-used, not "code exists but
             taken" (no invite enumeration)
/onboarding  the interview chat (server-side, Anthropic SDK, resumable via
             onboarding_sessions) — stages 1-3 only: resume ingestion,
             identity & logistics, targeting. Voice / proof points /
             archetypes / template pick are tailor-era, out of v1.
/feed        scored matches grouped New/Saved/Applied/Dismissed (collapsed);
             save/dismiss/"I applied"/undo via the authed client, batched
             new -> seen marking, profile-health banner when
             `profiles.validation_status.status === 'invalid'`
```

The `(app)` route group's layout (`app/(app)/layout.tsx`) is the actual
auth + invite gate — not `proxy.ts` (Next.js 16's renamed `middleware.ts`),
which only refreshes the session cookie. This mirrors a proven magic-link
pattern: the chunked Supabase auth cookie isn't reliably readable from
every proxy runtime, so Server Components are the gate and proxy is a
refresh layer only.

## What the interview deliberately does NOT collect

Per `planning/HOSTED_AGGREGATOR_PLAN.md` §7 (minimal-collection
principle) and the H3 session prompt: no `application_defaults` (work
authorization, visa sponsorship, earliest start date, relocation-for-forms,
AI-policy acknowledgement, previous-interview-with-company) — the hosted
aggregator never fills out application forms, so those questions don't
belong here. `profile.yml` still writes the key present-but-blank (the
schema requires the key, not a non-empty value) — see
`lib/profile/buildDoc.ts`.

Also out of v1 (tailor-era, stages 4-7 of `onboarding/SKILL.md`): voice
elicitation, proof points, archetypes, resume-template pick. Their files
(`voice-profile.md`, `article-digest.md`, `learned-insights.md`) ship as
valid empty stubs.

## Validation

`lib/profile/validate.ts` ports `onboarding/validate_profile.py`'s
REQUIRED-level (ERROR) checks only — the same shallow "two-level
required-key present" fallback that script uses when `jsonschema` isn't
installed. It's for immediate UX feedback in the chat; the authoritative
Python validator still runs at materialization time (H4's worker) and
overwrites `profiles.validation_status` with its own verdict.
`tests/test_h3_onboarding_doc_fixture.py` (repo root) is the cross-language
check that a real generated doc passes both.

## Tests

```bash
npm test     # vitest — invite-claim logic, the invite gate, TS validator,
             # buildProfileDoc, the onboarding turn handler (mocked
             # Anthropic + mocked db writes: one budget_ledger row per turn,
             # a profile upsert exactly when finish_interview fires), and
             # the feed's matches.ts (score ordering, state transitions +
             # 0-rows-affected failing loud, batched seen-marking,
             # optimistic-revert) + ProfileHealthBanner
```
