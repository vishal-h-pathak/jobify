-- 0011_v3a_modules.sql — V3a module spine: module-progress tracking +
-- reaction calibration table (V3A-1, session-prompts/30_v3a_spine.md).
--
-- Additive on top of 0001-0010. Apply after 0010 is already applied.
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
-- DROP POLICY IF EXISTS-then-CREATE), so re-running is safe.
--
-- Context (planning/PRODUCT_VISION.md §2+§5): the linear onboarding stage
-- machine generalizes to a module-progress model. `modules` jsonb tracks
-- per-module completion (`{ [key]: {completed_at, receipt} }`, keys from
-- `web/lib/onboarding/moduleRegistry.ts::ModuleKey`) independently of the
-- legacy `stage` column, which the v2 UI still reads untouched. Reaction
-- calibration (swiping real postings interested/not during onboarding) gets
-- its own table since it's keyed on (user, posting), not a single
-- onboarding_sessions row.

ALTER TABLE public.onboarding_sessions
  ADD COLUMN IF NOT EXISTS modules JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.posting_reactions (
  user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  posting_id  TEXT NOT NULL REFERENCES public.postings (id) ON DELETE CASCADE,
  reaction    TEXT NOT NULL CHECK (reaction IN ('interested', 'not_interested')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, posting_id)
);

ALTER TABLE public.posting_reactions ENABLE ROW LEVEL SECURITY;

-- Own-row SELECT/INSERT/UPDATE — users may change their mind about a
-- reaction (upsert on repeat swipe), but never DELETE (the calibration
-- audit trail stays intact).
DROP POLICY IF EXISTS posting_reactions_select_own ON public.posting_reactions;
CREATE POLICY posting_reactions_select_own ON public.posting_reactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS posting_reactions_insert_own ON public.posting_reactions;
CREATE POLICY posting_reactions_insert_own ON public.posting_reactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS posting_reactions_update_own ON public.posting_reactions;
CREATE POLICY posting_reactions_update_own ON public.posting_reactions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
