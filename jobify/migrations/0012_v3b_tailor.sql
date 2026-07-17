-- 0012_v3b_tailor.sql — V3b hosted tailor tracking: tailor_runs table +
-- cooldown index + RLS (V3B-1, planning/V3B_DESIGN.md §1.3).
--
-- Additive on top of 0001-0011. Apply after 0011 is already applied.
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS /
-- DROP POLICY IF EXISTS-then-CREATE), so re-running is safe.
--
-- Context (planning/V3B_DESIGN.md §1.3): the tailor moves to a hosted GHA
-- compute plane (not Vercel serverless, due to LaTeX PDF rendering needing
-- pdflatex + 250MB bundle cap). One new table tracks the async tailor run
-- lifecycle: dispatch → generating → succeeded | failed. Storage path becomes
-- job-materials/{user_id}/{posting_id}/ (user-scoped private prefix).
--
-- Cooldown mechanism: the UNIQUE partial index on (user_id, posting_id)
-- WHERE status IN ('queued','running') enforces per-posting cooldown — a
-- second dispatch for the same posting while one is in flight fails the insert
-- with a unique-violation constraint error. This is the entire cooldown
-- implementation; no timer columns or cron required.
--
-- RLS: own-row SELECT (polling), INSERT/UPDATE service-role only. The web
-- route gates authentication then inserts with the service-role admin client;
-- the GHA worker updates via service role. Storage policy restricts reads to
-- own user's path prefix: (storage.foldername(name))[1] = auth.uid()::text.

CREATE TABLE IF NOT EXISTS public.tailor_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  posting_id text NOT NULL REFERENCES public.postings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed')),
  mode text NOT NULL DEFAULT 'tailor' CHECK (mode IN ('tailor','render')),
  template text, feedback text,                 -- regenerate-with-note (§3.4)
  progress jsonb NOT NULL DEFAULT '[]',         -- [{step,label,at}] worker-appended
  doc_sha256 text,                              -- profiles.doc snapshot hash at gen time
  dropped_count int, error text, cost_usd numeric,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tailor_runs_one_active
  ON public.tailor_runs (user_id, posting_id) WHERE status IN ('queued','running');

ALTER TABLE public.tailor_runs ENABLE ROW LEVEL SECURITY;

-- RLS: own-row SELECT (polling). INSERT/UPDATE service-role only — the web route
-- gates then inserts with the admin client; the worker updates via service role.
DROP POLICY IF EXISTS tailor_runs_select_own ON public.tailor_runs;
CREATE POLICY tailor_runs_select_own ON public.tailor_runs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS tailor_runs_insert_service ON public.tailor_runs;
CREATE POLICY tailor_runs_insert_service ON public.tailor_runs
  FOR INSERT TO service_role
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS tailor_runs_update_service ON public.tailor_runs;
CREATE POLICY tailor_runs_update_service ON public.tailor_runs
  FOR UPDATE TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- Storage policy: job-materials bucket, user-scoped path prefix.
-- Read access for authenticated users on own prefix: (storage.foldername(name))[1] = auth.uid()::text
DROP POLICY IF EXISTS job_materials_select_own ON storage.objects;
CREATE POLICY job_materials_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
