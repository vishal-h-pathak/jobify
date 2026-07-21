-- 0018_board_health.sql — HUNT2 P3 S6: board health + telemetry
-- (planning/HUNT2_SOURCES.md §5, session-prompts/54_hunt2_s6_health.md).
--
-- Additive on top of 0001-0017. Session 53 (parallel, same base) owns no
-- migration this round — this file applies cleanly on top of 0017
-- regardless of ordering. Idempotent (CREATE TABLE IF NOT EXISTS / DROP
-- POLICY IF EXISTS-then-CREATE / DROP CONSTRAINT IF EXISTS-then-ADD /
-- CREATE OR REPLACE VIEW), so re-running is safe. NEVER APPLIED against a
-- live project this session (owner-only step, matching every prior
-- migration's convention) — DDL only, no data migration.
--
-- board_health: one row per (board_id, day) — `jobify.hosted.board_health
-- .run_board_health_cycle` upserts it on EVERY hosted-worker poll, for
-- EVERY board_catalog row (not just boards some user's portals.yml
-- references), recording that poll's HTTP status, live posting count,
-- and the impostor name-check result (Greenhouse board-metadata `name` /
-- Ashby `organizationName` vs. the catalog's own `company_name`; Lever
-- and Workday expose no such metadata endpoint, so `name_check_ok` stays
-- NULL — exempt, not failed). RLS: service-role ALL only, same posture
-- as `candidate_boards` (0017) — only the Python worker and the
-- requireAdmin()-gated admin routes ever touch this table.
CREATE TABLE IF NOT EXISTS public.board_health (
  board_id       UUID NOT NULL REFERENCES public.board_catalog(id),
  day            DATE NOT NULL DEFAULT CURRENT_DATE,
  http_status    INT,
  posting_count  INT,
  name_check_ok  BOOLEAN,
  PRIMARY KEY (board_id, day)
);

ALTER TABLE public.board_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS board_health_service_all ON public.board_health;
CREATE POLICY board_health_service_all ON public.board_health
  FOR ALL TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- board_catalog.status (0015) had no CHECK at all — every existing row is
-- 'active' (the only value any write path has ever used), so this is
-- purely additive: formalizes the three values this session's kill rules
-- + dead-board alerting actually use. 'dormant' = zero surfaced matches
-- for any user in 90 days (still cheap-fetched, excluded from tier
-- packs, admin-set only); 'dead' = a board_health alert (404/410, zero
-- postings against a nonzero 90-day baseline, or a failed name-check),
-- set by `run_board_health_cycle` itself, not admin-gated (the alert IS
-- the signal; only the RELOCATION swap is admin-gated, never this status
-- flip).
ALTER TABLE public.board_catalog DROP CONSTRAINT IF EXISTS board_catalog_status_check;
ALTER TABLE public.board_catalog
  ADD CONSTRAINT board_catalog_status_check CHECK (status IN ('active', 'dormant', 'dead'));

-- feeder_cursors: generic tiny state row per named feeder, folded in here
-- rather than a dedicated migration for one column. Today only
-- `jobify.hosted.feeders.aggregator` uses it (P2 S4 flag: its
-- `route_candidates()` used to full-table-scan `matches` every cycle;
-- now it reads only rows created after `cursor_at` and advances the
-- cursor to the max `created_at` it saw). `cursor_at` is nullable so a
-- feeder's first-ever run reads everything (no cursor yet) exactly like
-- before this migration. RLS: service-role ALL only — worker-internal
-- bookkeeping, never read by the web app.
CREATE TABLE IF NOT EXISTS public.feeder_cursors (
  feeder      TEXT PRIMARY KEY,
  cursor_at   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feeder_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feeder_cursors_service_all ON public.feeder_cursors;
CREATE POLICY feeder_cursors_service_all ON public.feeder_cursors
  FOR ALL TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- source_funnel_rollup: one row per (source, paid-query, catalog board) —
-- postings contributed / matches surfaced / distinct users engaged
-- (`matches.state IN ('seen','saved','applied')`), each as a pair of
-- rolling FILTER-clause counts (60d / 90d, evaluated live against
-- `now()` on every SELECT — this is a plain view, not materialized, so
-- the windows are always current). `query_key` is
-- `postings.raw->>'_jobify_query'` (session 53's per-query provenance,
-- HUNT2_SOURCES.md §5 "Funnel attribution") — NULL for every portal
-- (greenhouse/lever/ashby/workday) posting, populated only for
-- jsearch/serpapi rows once that provenance write lands; a rollup row
-- with a NULL query_key and a non-NULL board_id is a catalog board, one
-- with a non-NULL query_key is a paid query, and the admin "Sources"
-- card (`web/lib/admin/sourceHealth.ts`) tells the two apart by which
-- key is populated rather than by `source` alone. Board identity is
-- joined on `(ats, company_name)` — `postings` has no `board_id` FK
-- column (out of this session's scope to add; see HUNT2_SOURCES.md §5's
-- broader provenance note) — a pragmatic, name-based join, not exact for
-- a board whose catalog `company_name` has drifted from what a fetcher
-- currently reports.
CREATE OR REPLACE VIEW public.source_funnel_rollup AS
SELECT
  p.source,
  p.raw->>'_jobify_query' AS query_key,
  bc.id AS board_id,
  bc.company_name AS board_company_name,
  bc.status AS board_status,
  count(*) FILTER (WHERE p.last_seen_at >= now() - interval '60 days') AS postings_60d,
  count(*) FILTER (WHERE p.last_seen_at >= now() - interval '90 days') AS postings_90d,
  count(*) FILTER (
    WHERE m.status = 'surfaced' AND p.last_seen_at >= now() - interval '60 days'
  ) AS surfaced_60d,
  count(*) FILTER (
    WHERE m.status = 'surfaced' AND p.last_seen_at >= now() - interval '90 days'
  ) AS surfaced_90d,
  count(DISTINCT m.user_id) FILTER (
    WHERE m.state IN ('seen', 'saved', 'applied') AND p.last_seen_at >= now() - interval '60 days'
  ) AS users_engaged_60d,
  count(DISTINCT m.user_id) FILTER (
    WHERE m.state IN ('seen', 'saved', 'applied') AND p.last_seen_at >= now() - interval '90 days'
  ) AS users_engaged_90d
FROM public.postings p
LEFT JOIN public.board_catalog bc ON bc.ats = p.source AND bc.company_name = p.company
LEFT JOIN public.matches m ON m.posting_id = p.id
GROUP BY p.source, p.raw->>'_jobify_query', bc.id, bc.company_name, bc.status;
