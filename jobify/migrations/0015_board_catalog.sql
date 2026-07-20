-- 0015_board_catalog.sql — HUNT2 P1 S2: curated starter catalog of
-- verified ATS boards (planning/HUNT2_SOURCES.md §3.3).
--
-- Additive on top of 0001-0013. Deliberately does NOT reference or depend
-- on 0014 (owned by session 47, running in parallel on the same base) —
-- applies cleanly on top of 0013 whether or not 0014 has landed yet.
-- Idempotent (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS-then-
-- CREATE), so re-running is safe.
--
-- board_catalog is global and shared across all users (no user_id column)
-- — a curated set of verified ATS boards, seeded initially from
-- job-pipeline's 51 hand-verified boards
-- (jobify/data/board_catalog_seed.yml, imported by
-- web/scripts/importBoardCatalog.ts — NOT run by this migration, the
-- cockpit runs it after 0015 is applied live). Discovery unions all
-- users' portals plus catalog boards referenced by tier packs
-- (web/lib/portals/tierPacks.ts), so catalog growth benefits every user
-- without per-user hand-seeding; per-user relevance stays the job of the
-- existing scoring ladder (planning/HUNT2_SOURCES.md §4.1 rationale).
--
-- RLS: authenticated SELECT (every signed-in user can read the catalog to
-- build/refresh their tier pack); service-role ALL (only the admin import
-- script today, and later the S4 candidate-queue admission flow, write
-- here).

CREATE TABLE IF NOT EXISTS public.board_catalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ats           TEXT NOT NULL CHECK (ats IN ('greenhouse', 'ashby', 'lever', 'workday')),
  slug          TEXT NOT NULL,
  company_name  TEXT NOT NULL,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'active',
  added_by      TEXT NOT NULL DEFAULT 'import',
  verified_at   TIMESTAMPTZ,
  UNIQUE (ats, slug)
);

ALTER TABLE public.board_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS board_catalog_select_authenticated ON public.board_catalog;
CREATE POLICY board_catalog_select_authenticated ON public.board_catalog
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS board_catalog_service_all ON public.board_catalog;
CREATE POLICY board_catalog_service_all ON public.board_catalog
  FOR ALL TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);
