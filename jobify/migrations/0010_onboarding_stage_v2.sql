-- 0010_onboarding_stage_v2.sql — onboarding interview v2 stage machine (ONB-A).
--
-- Additive on top of 0001-0009. Apply after 0009 is already applied.
-- Idempotent (DROP-then-ADD CONSTRAINT), so re-running is safe.
--
-- Context (planning/ONBOARDING_REDESIGN.md §2, session-prompts/26): the
-- interview is restructured from resume-first (resume -> identity ->
-- targeting -> done) to anchor-first (anchor -> calibration -> resume,
-- now optional -> targeting -> done). 'identity' as a *stage* goes away —
-- the record_identity tool still exists, but now fires during the
-- 'targeting' stage instead of its own stage.
--
-- No grandfathering (owner decision #5, 2026-07-05): nobody is onboarded
-- yet, so this remap is a safety net, not a real migration of live data.
-- Completed (status='complete') sessions are untouched either way.

-- 1. Drop the old stage CHECK constraint.
ALTER TABLE public.onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_stage_check;

-- 2. In-flight v1 sessions sitting in the retired 'identity' stage fold
--    into 'targeting', whose opener is the same batched logistics turn
--    'identity' used to ask.
UPDATE public.onboarding_sessions SET stage = 'targeting' WHERE stage = 'identity';

-- 3. Re-add the CHECK constraint with the v2 stage set. 'resume' stays
--    legal (now optional rather than first) so no session is ever left
--    holding an illegal stage value; 'identity' is deliberately dropped —
--    step 2 already remapped every occurrence.
ALTER TABLE public.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_stage_check
  CHECK (stage IN ('anchor', 'calibration', 'resume', 'targeting', 'done'));

-- 4. New sessions start at the anchor stage, not resume.
ALTER TABLE public.onboarding_sessions ALTER COLUMN stage SET DEFAULT 'anchor';
