-- 0014_hunt2_funnel.sql — HUNT2 P0.5/P0.7: full-funnel matches rows +
-- location-tier ranking (planning/HUNT2_SOURCES.md §2, session 47).
--
-- Additive on top of 0001-0013. Apply after 0013 is already applied.
-- Idempotent (ADD COLUMN IF NOT EXISTS / DROP-then-ADD CONSTRAINT / CREATE
-- INDEX IF NOT EXISTS), so re-running is safe.
--
-- Context: `jobify.hosted.fanout` (H4 Task 3) previously wrote NO `matches`
-- row for a posting that failed the title filter or was hard-disqualified
-- by the rubric (planning/HUNT2_SOURCES.md diagnosis, B#7 "invisible
-- funnel") — a run's actual pool->scored->surfaced shape was unrecoverable
-- after the fact. P0.5 changes `_run_user_ladder` to write a row for
-- EVERY posting it considers, tagged with which stage it fell out at (or
-- `surfaced` if it made it all the way through) — see
-- jobify/shared/match_status.py for the canonical enum and the
-- three-way contract this migration's CHECK constraint is pinned to.
--
-- `status` (not `state`, which already exists and tracks the user's own
-- new/seen/saved/dismissed/applied triage — a separate, orthogonal
-- concept) defaults to `'surfaced'` so every pre-existing row — written
-- back when only survivors ever got a row at all — stays valid without a
-- backfill.
--
-- `location_tier` (P0.7 — owner directive) is the per-user location-fit
-- ranking dimension that replaces the old hard discovery-time Atlanta
-- filter (P0.1): 1 = preferred metro or acceptable-remote, 2 =
-- ambiguous/unknown location, 3 = onsite outside the preferred metro
-- (ranked low, not excluded, unless the user's own dealbreakers disqualify
-- it — in which case it's a `rejected_rubric` row instead, not a tier-3
-- `surfaced` one). NULL for rows where a tier was never computed (anything
-- that didn't reach stage-2 rubric scoring).

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'surfaced';
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS location_tier SMALLINT;

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN (
    'rejected_title',
    'rejected_rubric',
    'rejected_rerank',
    'rejected_llm',
    'surfaced'
  ));

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_location_tier_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_location_tier_check
  CHECK (location_tier IS NULL OR location_tier IN (1, 2, 3));

-- Feed/count queries filter `status = 'surfaced'` (web/lib/db/matches.ts
-- callers) and order by `(location_tier ASC, best-score DESC)` — this
-- index serves both.
CREATE INDEX IF NOT EXISTS matches_user_status_tier_idx
  ON public.matches (user_id, status, location_tier);
