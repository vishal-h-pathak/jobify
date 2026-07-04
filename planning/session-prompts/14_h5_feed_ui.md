# Session 14 — H5: Feed UI  (Hosted wave 3)

**Run from:** a `jobify-wt/hosted-h5-feed` worktree.
**Depends on:** waves 1–2 merged to main (H1–H4) + migration 0005.
**Parallel-safe with:** H6 (15). File boundaries this wave:
- **You own:** `web/app/(app)/feed/**`, `web/app/(app)/layout.tsx`, `web/lib/db/matches.ts` (new) + its tests, `web/components/**` you create, `web/README.md`.
- **Do NOT touch:** `web/app/(app)/settings/**`, `web/app/api/keys/**`, `web/lib/crypto/**`, anything under `jobify/` (Python), `jobify/migrations/` — H6 owns those this wave.
- Shared files you must NOT edit (H6 may): none expected; if you find yourself needing one, stop and note it in the report instead.

---

## Context

Read `planning/HOSTED_AGGREGATOR_PLAN.md` §2 and `docs/SCORING.md`. Waves 1–2
built the schema, the onboarding chat that writes `profiles.doc`, and the
worker that fills `matches` with ladder scores + reasons. This session builds
what a friend actually sees every day: the feed. A live Supabase project now
exists — `vujlecpmurismvnjebcf` (us-east-1); use its URL + anon key in
`web/.env.local` for dev (Vishal supplies keys; never commit them). All feed
reads/writes go through the **authed anon client** — RLS is the security
boundary, service-role must NOT appear in any feed code path.

## Tasks

1. **Feed page** (`web/app/(app)/feed/`) — replace the H3 stub. Server
   component fetches the user's `matches` joined with `postings` (two queries
   through the authed client are fine), ordered by best-available score
   (`llm_score` → `embed_score` → `rubric_score`, first non-null), grouped by
   state: **New** (state `new`/`seen`), **Saved**, **Applied**; `dismissed`
   hidden behind a collapsed "Dismissed" section. Each card: title, company,
   location/remote, score badge with `reason` (and `reason_source` styling —
   LLM reasons get prominence, rubric reasons render muted), link to
   `application_url` (else `postings.raw->>url`), relative "first seen".
2. **State transitions** (`web/lib/db/matches.ts` + client actions) — Save,
   Dismiss, **"I applied"** (explicit human click — never automatic; carries
   over the applied-is-a-human-action rule), Undo-dismiss. Mark `new → seen`
   in bulk when cards render. All via the authed client so RLS enforces
   ownership; optimistic UI with revert on error. `state_changed_at` updated
   on every transition.
3. **Profile-health banner** — `profiles.validation_status` is JSONB
   `{"status", "errors"}` (wave-2 reconciliation). When `status = 'invalid'`,
   show a banner listing `errors` with a link back to onboarding. When the
   user has no profile / onboarding incomplete, redirect to onboarding.
4. **Nav** (`web/app/(app)/layout.tsx`) — add a simple nav: **Feed** and
   **Settings** links (Settings page itself is H6's — link may 404 in your
   branch; that's expected and fine at merge).
5. **Empty states** — no matches yet ("the hunter runs daily — check back
   tomorrow" tone), everything dismissed, brand-new user mid-first-cycle.
6. **Tests** — vitest: ordering (llm > embed > rubric fallback), state
   transition calls + optimistic revert, banner renders errors, seen-marking
   is batched not per-card. Mock the Supabase client (follow
   `web/lib/db/invites.test.ts`'s fake pattern).

## Review note (carry-over lesson)

The invite-claim bug (migration 0005) taught us: authed-client UPDATE flows
can silently no-op under RLS policy interaction. Your state transitions
UPDATE `matches` WHERE the row is the user's own — that passes both the
SELECT and UPDATE own-row policies, but **assert non-zero affected rows** in
`web/lib/db/matches.ts` and surface a visible error otherwise, so a policy
regression fails loud in the UI instead of silently losing clicks. The merge
review will re-run the live RLS battery including these transitions.

## Exit criteria

- `npm run build` clean; vitest green; `npx tsc --noEmit` clean.
- No `SUPABASE_SERVICE_ROLE_KEY` import anywhere under `web/app/(app)/feed/`
  or `web/lib/db/matches.ts`.
- `git diff --stat`: nothing under `jobify/`, `dashboard/`, `web/app/(app)/settings/`, `web/app/api/keys/`.
- Commit: `H5: feed UI — scored match cards, state transitions, profile-health banner`.
- Push the branch; do NOT merge — review-then-merge.
