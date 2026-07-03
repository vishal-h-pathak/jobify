-- 0003_hosted_onboarding.sql — invite gate + onboarding chat (H3).
--
-- Additive on top of 0001_init.sql + 0002_multitenant.sql. Apply to a
-- project that already has both (SQL Editor, `supabase db push`, or the
-- MCP `apply_migration` tool). Idempotent (IF NOT EXISTS / DROP-then-CREATE
-- POLICY), so re-running is safe.
--
-- This migration backs the hosted web app's sign-in -> invite -> onboarding
-- flow (planning/HOSTED_AGGREGATOR_PLAN.md §2, session-prompts/12):
--
--     invites            — one row per invite code; service-role creates
--                           them, an authed user claims an unclaimed code
--                           for themselves once.
--     profiles.validation_status
--                        — new column on the existing `profiles` table
--                           (0002): records the outcome of the profile-doc
--                           validation contract (see task 4 of the H3
--                           session prompt) — the web app's TS validator
--                           writes 'unchecked'/'valid'; H4's worker
--                           overwrites with the authoritative Python
--                           validator's verdict at materialization time.
--     onboarding_sessions — server-side interview state keyed by user_id,
--                           so a dropped connection resumes the onboarding
--                           chat instead of restarting it.
--
-- ── Key / RLS contract ────────────────────────────────────────────────────
--   * invites: NO select policy for `authenticated` beyond a user's own
--     claimed row — an unclaimed code must not be enumerable by reading the
--     table. Claiming is a single conditional UPDATE (`USING (claimed_by IS
--     NULL)`), so an invalid or already-used code just updates zero rows;
--     the client checks the row count, not a prior SELECT. Only
--     service-role inserts new codes (out-of-band, admin path).
--   * profiles.validation_status: no RLS change needed — column-level
--     access follows the existing `profiles` row policies from 0002.
--   * onboarding_sessions: authed users may select/insert/update ONLY their
--     own row (user_id = auth.uid()), same shape as `profiles` in 0002. No
--     delete policy — the client never deletes a session; a completed
--     session simply flips `status`.

-- ══════════════════════════════════════════════════════════════════════════
--  invites — one row per invite code
-- ══════════════════════════════════════════════════════════════════════════
-- code is the invite token itself (opaque text, generated out-of-band by
-- whoever hands out invites). claimed_by/claimed_at are set together when
-- an authed user successfully claims the code; NULL means unclaimed.

CREATE TABLE IF NOT EXISTS public.invites (
  code          TEXT PRIMARY KEY,
  created_by    UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  claimed_by    UUID REFERENCES auth.users (id) ON DELETE CASCADE,
  claimed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invites_claimed_by ON public.invites (claimed_by);

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- A user may see only the invite THEY hold (post-claim) — never an
-- unclaimed code, which would let any authed user enumerate valid codes.
DROP POLICY IF EXISTS invites_select_own_claim ON public.invites;
CREATE POLICY invites_select_own_claim ON public.invites
  FOR SELECT TO authenticated
  USING (claimed_by = auth.uid());

-- Claim: succeeds only when the code is currently unclaimed, and only ever
-- assigns it to the caller's own user_id. Zero rows updated == invalid or
-- already-claimed code from the caller's point of view.
DROP POLICY IF EXISTS invites_claim_unclaimed ON public.invites;
CREATE POLICY invites_claim_unclaimed ON public.invites
  FOR UPDATE TO authenticated
  USING (claimed_by IS NULL)
  WITH CHECK (claimed_by = auth.uid());
-- No insert/delete policy for `authenticated`: codes are minted by
-- service-role only.


-- ══════════════════════════════════════════════════════════════════════════
--  profiles.validation_status — profile-doc validation outcome
-- ══════════════════════════════════════════════════════════════════════════
-- Shape: {"status": "unchecked" | "valid" | "invalid", "errors": [...]}.
-- NULL until the web app's onboarding chat writes the first doc.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS validation_status JSONB;


-- ══════════════════════════════════════════════════════════════════════════
--  onboarding_sessions — server-side interview state, keyed by user
-- ══════════════════════════════════════════════════════════════════════════
-- messages is the running chat transcript ([{role, content}, ...]);
-- extracted is the structured data gathered so far, merged stage by stage,
-- and becomes the source the final profiles.doc is generated from. A
-- dropped connection just re-reads this row and re-renders the transcript
-- — no restart.

CREATE TABLE IF NOT EXISTS public.onboarding_sessions (
  user_id       UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  stage         TEXT NOT NULL DEFAULT 'resume',
  messages      JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'in_progress',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_sessions_stage_check
    CHECK (stage IN ('resume', 'identity', 'targeting', 'done')),
  CONSTRAINT onboarding_sessions_status_check
    CHECK (status IN ('in_progress', 'complete'))
);

ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_sessions_select_own ON public.onboarding_sessions;
CREATE POLICY onboarding_sessions_select_own ON public.onboarding_sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS onboarding_sessions_insert_own ON public.onboarding_sessions;
CREATE POLICY onboarding_sessions_insert_own ON public.onboarding_sessions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS onboarding_sessions_update_own ON public.onboarding_sessions;
CREATE POLICY onboarding_sessions_update_own ON public.onboarding_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
