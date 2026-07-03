-- 0002_multitenant.sql — hosted multi-tenant schema (H1).
--
-- Additive on top of 0001_init.sql. Apply to a project that already has
-- 0001 (SQL Editor, `supabase db push`, or the MCP `apply_migration` tool).
-- Idempotent (IF NOT EXISTS / DROP-then-ADD / DROP-then-CREATE POLICY), so
-- re-running is safe.
--
-- 0001's tables (jobs / runs / application_attempts) are untouched: jobify
-- keeps running service-role-only against those for the single-user
-- pipeline. Everything here is for the hosted aggregator (see
-- planning/HOSTED_AGGREGATOR_PLAN.md §3):
--
--     profiles       — one row per user; the 8 profile-file contract as
--                       one JSONB document, plus the compiled rubric and
--                       an embedding for stage-2 scoring
--     postings       — GLOBAL job postings pool, no user_id. Discovery and
--                       embeddings amortize across every user.
--     matches        — user_id × posting_id; ladder scores + aggregator
--                       state (new → seen → saved | dismissed | applied —
--                       see jobify/shared/match_state.py). This is a
--                       DIFFERENT state machine from jobs.status; the
--                       existing status contract (jobify/shared/status.py,
--                       status.json, tests/test_status_contract.py) is not
--                       touched by this migration.
--     budget_ledger  — append-only per-user token/cost events
--     budget_caps    — per-user monthly spend cap, service-role-managed
--     api_keys       — optional BYO Anthropic key (ciphertext only)
--
-- ── Key / RLS contract ────────────────────────────────────────────────────
-- Old tables: unchanged, RLS-enabled-no-policies, service-role only.
-- New tables:
--   * profiles / matches / api_keys: authed users may select/insert/update
--     ONLY their own row (user_id = auth.uid()). No delete policy — the
--     client never deletes these; use service-role for account deletion
--     (auth.users cascade handles it, see the FKs below).
--   * budget_ledger: authed users may select/insert their own rows only.
--     No update, no delete — genuinely append-only from the client's
--     perspective (an update policy would let a user rewrite past spend).
--   * budget_caps: authed users may SELECT their own cap only. No insert/
--     update/delete policy for `authenticated` — caps are set by
--     service-role (billing/admin path), so a user can see but not raise
--     their own limit.
--   * postings: authed users may select (read) all rows; no insert/
--     update/delete policy — writes are service-role only (the worker).
--
-- Run the isolation tests after applying: see
-- jobify/migrations/README.md "0002 — hosted multi-tenant tables" and
-- tests/test_rls_multitenant.py (skips cleanly without a local Supabase
-- stack / SUPABASE_* env vars).

-- pgvector, for profile/posting embeddings.
CREATE EXTENSION IF NOT EXISTS vector;


-- ══════════════════════════════════════════════════════════════════════════
--  profiles — one row per hosted user
-- ══════════════════════════════════════════════════════════════════════════
-- doc holds the 8 profile-file contract (profile.yml, thesis.md,
-- voice-profile.md, article-digest.md, cv.md, disqualifiers.yml,
-- portals.yml, learned-insights.md) as {filename: contents} — the same
-- shape H2's DB profile_loader backend reads. compiled_rubric is written
-- by H2's rubric compiler; null until compiled. embedding is provisional
-- at 1024 dims — H4 confirms the embedding provider.

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id           UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  doc               JSONB NOT NULL,
  compiled_rubric   JSONB,
  embedding         VECTOR (1024),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ══════════════════════════════════════════════════════════════════════════
--  postings — global job postings pool (no user_id)
-- ══════════════════════════════════════════════════════════════════════════
-- id is jobify.shared.jobid's deterministic id (same source-agnostic hash
-- the single-user jobs table uses) so cross-source dedup is a PK conflict
-- here too. One row per real posting, shared by every user's matches.

CREATE TABLE IF NOT EXISTS public.postings (
  id                TEXT PRIMARY KEY,
  title             TEXT,
  company           TEXT,
  location          TEXT,
  remote            BOOLEAN,
  description       TEXT,
  application_url   TEXT,
  ats_kind          TEXT,
  link_status       TEXT,
  source            TEXT,
  posted_at         TIMESTAMPTZ,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding         VECTOR (1024),
  raw               JSONB
);

CREATE INDEX IF NOT EXISTS idx_postings_last_seen ON public.postings (last_seen_at);

ALTER TABLE public.postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS postings_select_authenticated ON public.postings;
CREATE POLICY postings_select_authenticated ON public.postings
  FOR SELECT TO authenticated
  USING (true);
-- No insert/update/delete policy: only the service-role worker writes here.


-- ══════════════════════════════════════════════════════════════════════════
--  matches — user_id × posting_id, ladder scores + aggregator state
-- ══════════════════════════════════════════════════════════════════════════
-- reason_source records whether `reason` came from the cheap rubric pass
-- or an LLM verdict (see HOSTED_AGGREGATOR_PLAN.md §4 scoring ladder).
-- state is a SEPARATE lifecycle from jobs.status — see
-- jobify/shared/match_state.py; matches_state_check below is generated
-- from the same CANONICAL_MATCH_STATES list (tests/test_match_state_contract.py
-- pins both).

CREATE TABLE IF NOT EXISTS public.matches (
  user_id           UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  posting_id        TEXT NOT NULL REFERENCES public.postings (id) ON DELETE CASCADE,
  rubric_score      REAL,
  embed_score       REAL,
  llm_score         REAL,
  reason            TEXT,
  reason_source     TEXT,
  state             TEXT NOT NULL DEFAULT 'new',
  state_changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, posting_id),
  CONSTRAINT matches_reason_source_check
    CHECK (reason_source IS NULL OR reason_source IN ('llm', 'rubric'))
);

-- Canonical matches.state CHECK. This list MUST stay in lockstep with
-- jobify/shared/match_state.json (CANONICAL_MATCH_STATES) — see
-- tests/test_match_state_contract.py.
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_state_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_state_check CHECK (
  state = ANY (ARRAY[
    'new',
    'seen',
    'saved',
    'dismissed',
    'applied'
  ]::text[])
);

CREATE INDEX IF NOT EXISTS idx_matches_user_state ON public.matches (user_id, state);

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matches_select_own ON public.matches;
CREATE POLICY matches_select_own ON public.matches
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS matches_insert_own ON public.matches;
CREATE POLICY matches_insert_own ON public.matches
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS matches_update_own ON public.matches;
CREATE POLICY matches_update_own ON public.matches
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ══════════════════════════════════════════════════════════════════════════
--  budget_ledger — append-only per-user token/cost events
-- ══════════════════════════════════════════════════════════════════════════
-- One row per llm.complete-style chokepoint call (event names like
-- 'onboarding_turn', 'rubric_compile', 'llm_verdict', 'embedding' — not an
-- exhaustive enum, so no CHECK here). run_id is a loose, unconstrained
-- reference (TEXT, no FK): the hosted worker's "run" concept isn't owned
-- by this migration.

CREATE TABLE IF NOT EXISTS public.budget_ledger (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event          TEXT NOT NULL,
  model          TEXT,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(10, 6) NOT NULL DEFAULT 0,
  run_id         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_ledger_user_created
  ON public.budget_ledger (user_id, created_at DESC);

ALTER TABLE public.budget_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_ledger_select_own ON public.budget_ledger;
CREATE POLICY budget_ledger_select_own ON public.budget_ledger
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS budget_ledger_insert_own ON public.budget_ledger;
CREATE POLICY budget_ledger_insert_own ON public.budget_ledger
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
-- No update, no delete policy: ledger rows are immutable once written.


-- ══════════════════════════════════════════════════════════════════════════
--  budget_caps — per-user monthly spend cap (service-role-managed)
-- ══════════════════════════════════════════════════════════════════════════
-- A separate table rather than a column on profiles: the cap is a
-- billing/admin decision, not something the user's own profile edits
-- should be able to touch. Only a SELECT policy is granted to
-- `authenticated` — a user can see their cap but only service-role
-- (H6's cost-rails code) can set or raise it.

CREATE TABLE IF NOT EXISTS public.budget_caps (
  user_id           UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  monthly_usd_cap   NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_caps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_caps_select_own ON public.budget_caps;
CREATE POLICY budget_caps_select_own ON public.budget_caps
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
-- No insert/update/delete policy for `authenticated`: service-role only.


-- ══════════════════════════════════════════════════════════════════════════
--  api_keys — optional BYO Anthropic key (ciphertext only)
-- ══════════════════════════════════════════════════════════════════════════
-- encrypted_key: app-side encryption happens in H6 — this schema must
-- never see plaintext, hence the column name. RLS choice: own-row SELECT
-- (not an existence-only check) — simpler and consistent with the other
-- per-user tables; H6's app layer is responsible for never echoing the
-- ciphertext back to the client UI unnecessarily.

CREATE TABLE IF NOT EXISTS public.api_keys (
  user_id         UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  provider        TEXT NOT NULL DEFAULT 'anthropic',
  encrypted_key   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_select_own ON public.api_keys;
CREATE POLICY api_keys_select_own ON public.api_keys
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS api_keys_insert_own ON public.api_keys;
CREATE POLICY api_keys_insert_own ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS api_keys_update_own ON public.api_keys;
CREATE POLICY api_keys_update_own ON public.api_keys
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
