# Session 12 — H3: Hosted web app scaffold + onboarding chat  (Hosted wave 2)

**Run from:** a `jobify-wt/feat/hosted-h3-onboarding-web` worktree.
**Depends on:** H1+H2 (merged to main — `profiles` table + `0002_multitenant.sql` exist).
**Parallel-safe with:** H4 (13) — you own `web/` (new), `jobify/migrations/0003_hosted_onboarding.sql` (new), and docs. Do NOT touch `jobify/` package code, `dashboard/`, or `0002` — H4 owns the Python side this wave.

---

## Context

Read `planning/HOSTED_AGGREGATOR_PLAN.md` §2–§3 and `docs/ONBOARDING.md`. This
session builds the hosted product's web surface: a NEW Next.js app under
`web/` — deliberately separate from `dashboard/` (the single-user local
cockpit stays untouched; the hosted app is a different product surface and the
seam is the point). v1 scope: sign-in, invite gate, and the onboarding chat
that produces a valid `profiles.doc`. The feed UI is H5 (next wave) — leave a
stub route.

## Tasks

1. **Scaffold `web/`** — Next.js (App Router, TS, Tailwind), Supabase Auth
   with **magic links** (mirror the papercuts pattern), `@supabase/ssr`
   client. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (server-only), `ANTHROPIC_API_KEY`
   (server-only). `.env.example` with comments. No live project exists yet
   (infra decision deferred) — everything must run against a local
   `supabase start` stack; document that in `web/README.md`.

2. **Invite gate** — `0003_hosted_onboarding.sql` (additive, idempotent, same
   conventions as 0002): `invites` table (`code text PK`, `created_by`,
   `claimed_by uuid`, `claimed_at`; service-role writes, authed users may
   UPDATE only to claim an unclaimed code for themselves) and a
   `profiles.validation_status jsonb` column (see task 4). Sign-in without a
   claimed invite lands on an "enter invite code" page; no invite → no
   onboarding, no data written.

3. **Onboarding chat** — server-side route(s) using the Anthropic SDK
   (Sonnet-class), porting `onboarding/SKILL.md` stages 1–3 only (resume
   ingestion → identity/logistics → targeting + disqualifiers). Voice /
   proof-points / archetypes are tailor-era: OUT of v1.
   - Resume input: paste text or upload `.txt`/`.md` (PDF parsing is a
     nice-to-have, not required).
   - **PII minimization (plan §7):** collect name, location, remote
     preference, comp target, targeting tiers, disqualifiers. Do NOT collect
     `application_defaults` (work auth, sponsorship, start date, etc.) — the
     aggregator never fills forms. The interview must not ask for them.
   - Output: writes the eight-file `profiles.doc` JSONB (files the interview
     doesn't cover get valid minimal stubs — e.g. `voice-profile.md` empty,
     `learned-insights.md` empty, `portals.yml` seeded from targets like the
     skill does). `compiled_rubric` stays NULL — H4's worker compiles on
     first hunt.
   - Every LLM turn writes a `budget_ledger` row (`event =
     'onboarding_turn'`, tokens + cost) via service-role. This is H6's
     contract; don't skip it.
   - Interview state lives server-side keyed to the user (resumable; a
     dropped connection doesn't restart the interview).

4. **Validation** — port the REQUIRED-level checks of
   `onboarding/validate_profile.py` (required keys/files, profile.yml
   structure) to TS for immediate UX feedback before writing the row. The
   authoritative Python validator still runs at materialization time (H2);
   record its outcome contract by writing `profiles.validation_status`
   (`{"status": "unchecked" | "valid" | "invalid", "errors": [...]}`) —
   H3 writes `unchecked`/`valid` from the TS pass; H4's worker overwrites
   with the Python verdict.

5. **Tests + docs** — component/route tests for: invite gate (no invite →
   blocked), interview writes a doc that passes the TS validator, ledger row
   written per turn (mock Anthropic). `web/README.md`: local dev against
   `supabase start`, env table, what's stubbed for H5.

## Exit criteria

- `npm run build` clean; tests green with mocked Anthropic + local Supabase
  (skip cleanly when no local stack).
- A full mocked interview run produces a `profiles.doc` that
  `python onboarding/validate_profile.py` accepts (fixture-check this: dump
  the doc to a dir and run the real validator once in CI via a small pytest).
- `git diff --stat`: nothing under `jobify/` except `migrations/0003_hosted_onboarding.sql`; nothing under `dashboard/`.
- Commit: `H3: hosted web scaffold (auth + invite gate) + onboarding chat -> profiles.doc`.
- Push the branch; do NOT merge — review-then-merge.
