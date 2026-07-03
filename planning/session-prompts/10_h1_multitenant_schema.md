# Session 10 — H1: Multi-tenant schema + RLS  (Hosted wave 1)

**Run from:** a `jobify-wt/feat/hosted-h1-schema` worktree.
**Depends on:** nothing in this wave (additive migration on top of `0001_init.sql`).
**Parallel-safe with:** H2 (11) — touches `jobify/migrations/`, `jobify/shared/match_state.py`
(new), and `tests/` only. Do NOT touch `jobify/profile_loader.py` or `jobify/hunt/` —
H2 owns those this wave.

---

## Context

jobify is going hosted/multi-user, aggregator-first. Read
`planning/HOSTED_AGGREGATOR_PLAN.md` (§3 architecture, §7 risks) before starting.
Today's schema (`jobify/migrations/0001_init.sql`) is single-user: `jobs`/`runs`/
`application_attempts`, RLS enabled with NO policies, service-role only. Hosted v1
needs per-user isolation, a global postings pool, and per-user match state — without
disturbing the single-user pipeline tables or the status contract.

## The shared contract (H2 codes against this — do not deviate)

`profiles` row shape (agreed in the plan; H2's DB profile backend reads exactly this):

| column | type | notes |
|---|---|---|
| `user_id` | `uuid` PK, FK → `auth.users(id)` on delete cascade | |
| `doc` | `jsonb` NOT NULL | keys = the eight profile-file names (`profile.yml`, `thesis.md`, `voice-profile.md`, `article-digest.md`, `cv.md`, `disqualifiers.yml`, `portals.yml`, `learned-insights.md`); values = file contents as text |
| `compiled_rubric` | `jsonb` | written by H2's compiler; null until compiled |
| `embedding` | `vector(1024)` | nullable; provisional dimension, H4 confirms provider |
| `created_at` / `updated_at` | `timestamptz` | |

## Tasks

1. **`jobify/migrations/0002_multitenant.sql`** — additive only; `0001` untouched.
   - `create extension if not exists vector;`
   - `profiles` — exactly the contract table above.
   - `postings` — global, no `user_id`: `id text PK` (the `jobify.shared.jobid`
     deterministic id), `title`, `company`, `location`, `remote` (bool, nullable),
     `description`, `application_url`, `ats_kind`, `link_status`, `source`,
     `posted_at`, `first_seen_at`, `last_seen_at`, `embedding vector(1024)`
     (nullable), `raw jsonb`.
   - `matches` — `user_id uuid` FK, `posting_id text` FK → postings, PK
     `(user_id, posting_id)`; ladder outputs: `rubric_score real`,
     `embed_score real`, `llm_score real` (nullable), `reason text` (nullable),
     `reason_source text check in ('llm','rubric')`; `state text` with CHECK
     from the new match-state contract (task 2); `state_changed_at`,
     `created_at`.
   - `budget_ledger` — `id bigint identity PK`, `user_id`, `event` (e.g.
     `onboarding_turn`, `rubric_compile`, `llm_verdict`, `embedding`),
     `model`, `input_tokens`, `output_tokens`, `cost_usd numeric(10,6)`,
     `run_id` (nullable), `created_at`. Plus a `budget_caps` table or per-user
     cap column — your call, document it.
   - `api_keys` — `user_id` PK, `provider text default 'anthropic'`,
     `encrypted_key text`, `created_at`. Encryption happens app-side (H6);
     schema just must never store plaintext — name the column so that's obvious.
   - Helpful indexes: `matches(user_id, state)`, `postings(last_seen_at)`.

2. **Match-state contract** — `jobify/shared/match_state.py`, mirroring the
   `jobify/shared/status.py` pattern: states `new → seen → saved | dismissed |
   applied`, generated `match_state.json` artifact, and the Postgres CHECK in
   `0002` derived from the same list. Add `tests/test_match_state_contract.py`
   cloning the `test_status_contract.py` approach (source ↔ json ↔ SQL CHECK).
   **Do not modify `jobify/shared/status.py` or its test/json/CHECK** — the
   pipeline status machine is off-limits (aggregator state lives on `matches`).

3. **RLS — the load-bearing part.** Old tables keep their no-policy/service-role
   posture. New tables:
   - `profiles`, `matches`, `budget_ledger`, `api_keys`: enable RLS; policies so
     an authed user can `select/insert/update` ONLY rows where
     `user_id = auth.uid()`. No delete policy on `budget_ledger` (append-only
     from the client's perspective). `api_keys`: select limited to existence
     check if feasible, else own-row select is acceptable — document the choice.
   - `postings`: enable RLS; `select` for any authed user; writes service-role
     only (no insert/update/delete policies).

4. **Isolation tests, both directions.** `tests/test_rls_multitenant.py`,
   marked `@pytest.mark.integration`, running against a local Supabase stack
   (`supabase start`) or `DATABASE_URL` if provided; skip cleanly when absent.
   With two seeded users: (a) each sees own `profiles`/`matches` rows via authed
   client, (b) neither sees the other's rows, (c) anon (unauthenticated) sees
   nothing on the new tables, (d) authed user can read `postings` but cannot
   insert into it. Document how to run in the migration header + a short
   `docs/` note or README section.

## Exit criteria

- `0001` then `0002` apply cleanly to a fresh Postgres/Supabase project.
- `tests/test_match_state_contract.py` green; `tests/test_status_contract.py`
  green and **untouched by the diff**.
- Isolation tests pass locally against the supabase-cli stack; skip (not fail)
  without one.
- `git diff --stat` shows no changes under `jobify/hunt/`, `jobify/tailor/`,
  `jobify/submit/`, or `jobify/profile_loader.py`.
- Commit: `H1: multitenant schema (profiles/postings/matches/budget_ledger/api_keys) + RLS + match-state contract`.
- Push the branch; do NOT merge — review-then-merge.
