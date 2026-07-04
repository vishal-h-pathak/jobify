-- 0006_cost_rails.sql — cost rails: hard caps, global pool, BYO keys (H6).
--
-- Additive on top of 0001-0005. Apply after 0005 is already applied.
-- Idempotent (ADD COLUMN IF NOT EXISTS / DROP-then-CREATE POLICY), so
-- re-running is safe. Types pinned exactly to their 0002 counterparts
-- (wave-2 lesson: a mismatched type on an additive column is its own
-- migration to fix).
--
-- planning/HOSTED_AGGREGATOR_PLAN.md §4 / planning/session-prompts/
-- 15_h6_cost_rails.md. This phase is the launch blocker: no invites go
-- out until it merges.

-- ══════════════════════════════════════════════════════════════════════════
--  api_keys — safe UI display column + missing DELETE policy
-- ══════════════════════════════════════════════════════════════════════════
-- key_last4: the only part of a BYO key the settings UI ever shows back to
-- the user post-save ("...last4") — never the ciphertext, never plaintext.
-- updated_at: 0002's api_keys table predates this column; every other
-- per-user table already has one, added here for parity (paste-new-key is
-- an UPDATE, so "when did they last rotate it" needs a timestamp).

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS key_last4 TEXT;

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 0002 deliberately shipped api_keys with no DELETE policy (own-row
-- select/insert/update only — see that migration's header). H6's settings
-- page lets a user remove their BYO key, so the gap needs closing now.
DROP POLICY IF EXISTS api_keys_delete_own ON public.api_keys;
CREATE POLICY api_keys_delete_own ON public.api_keys
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ══════════════════════════════════════════════════════════════════════════
--  budget_ledger — byo flag (excludes BYO spend from pool accounting)
-- ══════════════════════════════════════════════════════════════════════════
-- A rubric compile or stage-4 verdict run on the user's OWN decrypted key
-- still gets a ledger row (real tokens were spent, and the row is useful
-- for the settings page's own-spend display) but must NOT count against
-- either the per-user pool cap or the global pool cap — those two caps
-- exist to bound OUR spend, not the user's. jobify.db.get_month_to_date_spend
-- and get_global_month_to_date_spend both filter `byo = FALSE`.

ALTER TABLE public.budget_ledger
  ADD COLUMN IF NOT EXISTS byo BOOLEAN NOT NULL DEFAULT FALSE;
