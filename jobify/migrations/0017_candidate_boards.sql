-- 0017_candidate_boards.sql — HUNT2 P2 S4: the discovery-loop candidate
-- queue (planning/HUNT2_SOURCES.md §4.1-§4.2, session 51).
--
-- Additive on top of 0001-0015. Deliberately does NOT reference or depend
-- on 0016 (owned by session 50, running in parallel on the same base) —
-- applies cleanly on top of 0015 whether or not 0016 has landed yet.
-- Idempotent (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS-then-
-- CREATE), so re-running is safe.
--
-- candidate_boards is the global queue by which companies nobody
-- hand-added enter `board_catalog` (0015): three feeders
-- (jobify.hosted.candidates' HN extraction / aggregator-unknown-company
-- routing / SerpAPI dorks) enqueue a row per candidate company;
-- jobify.hosted.candidates.enqueue() runs the slug probe on enqueue and
-- either auto-admits into board_catalog (high-confidence probe + live
-- postings) or leaves the row `pending` for human review via the admin
-- candidates UI. `normalized_name` is the dedup key — a REJECTED
-- candidate is never re-proposed, so every enqueue path must check this
-- table (any status) before inserting, the multi-user version of
-- job-pipeline's Skipped ledger.
--
-- RLS: service-role ALL only — no `authenticated` policy. Unlike
-- board_catalog (which every signed-in user reads to build a tier pack),
-- nothing here is user-facing; the admin candidates UI reads/writes
-- exclusively through server-side service-role routes
-- (web/app/api/admin/candidates*), gated by requireAdmin().

CREATE TABLE IF NOT EXISTS public.candidate_boards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name   TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  evidence_kind  TEXT NOT NULL CHECK (evidence_kind IN (
                   'hn_thread', 'aggregator_match', 'serpapi_dork',
                   'relocation', 'manual'
                 )),
  evidence_url   TEXT,
  proposed_ats   TEXT,
  proposed_slug  TEXT,
  probe_result   JSONB,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                   'pending', 'auto_admitted', 'approved', 'rejected'
                 )),
  reject_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ,
  UNIQUE (normalized_name)
);

ALTER TABLE public.candidate_boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS candidate_boards_service_all ON public.candidate_boards;
CREATE POLICY candidate_boards_service_all ON public.candidate_boards
  FOR ALL TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- The admin candidates UI's pending list + the enqueue-time dedup check
-- both filter/order on status; created_at DESC is the pending list's
-- display order.
CREATE INDEX IF NOT EXISTS candidate_boards_status_idx
  ON public.candidate_boards (status, created_at DESC);
