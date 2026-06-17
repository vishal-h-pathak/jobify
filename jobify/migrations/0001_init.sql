-- 0001_init.sql — jobify schema baseline (single-user, clean install).
--
-- Apply this ONCE against a fresh Supabase project (SQL Editor, or
-- `supabase db push` / the MCP `apply_migration` tool). It builds the
-- entire pipeline schema from scratch for the KEPT tables only:
--
--     jobs                  — the main pipeline row (hunt writes; tailor
--                             and submit transition status)
--     runs                  — dashboard-triggered hunt/tailor runs
--     application_attempts  — per-submit audit trail
--     job-materials bucket  — private Storage for generated PDFs + screenshots
--
-- This baseline SQUASHES the original 001..013 migrations (see
-- migrations/README.md for the provenance map). Two tables were DROPPED
-- on the way to single-user and are intentionally NOT created here:
--   • star_stories      (interview-prep STAR bank — trimmed subsystem)
--   • pattern_analyses  (closed-loop insights — trimmed subsystem)
--
-- Everything is idempotent (IF NOT EXISTS / DROP-then-ADD) so re-running
-- the file is safe.
--
-- ── Key / RLS contract ────────────────────────────────────────────────────
-- jobify runs SERVICE-ROLE ONLY. Every table below has RLS enabled with
-- NO policies: the service-role key bypasses RLS, while an anon key gets
-- HTTP 200 + empty result sets (no error). jobify.db refuses to construct
-- a client from a demonstrably-anon key so this fails loud rather than
-- silently reading empty. Put the service-role key in your .env as
-- SUPABASE_SERVICE_ROLE_KEY (see .env.example).

-- gen_random_uuid() for runs.id.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ══════════════════════════════════════════════════════════════════════════
--  jobs — the main pipeline row
-- ══════════════════════════════════════════════════════════════════════════
-- id is the canonical job id (sha1[:16] over source identity — see
-- jobify.shared.jobid). TEXT PK, not a UUID: hunt computes it
-- deterministically so cross-source dedup is a primary-key conflict.

CREATE TABLE IF NOT EXISTS public.jobs (
  id                       TEXT PRIMARY KEY,

  -- ── discovery (hunt) ────────────────────────────────────────────────────
  title                    TEXT,
  company                  TEXT,
  location                 TEXT,
  description              TEXT,
  url                      TEXT,
  source                   TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── scoring (hunt) ──────────────────────────────────────────────────────
  score                    NUMERIC,
  tier                     TEXT,
  reasoning                TEXT,
  action                   TEXT,         -- scorer's recommended_action
  legitimacy               TEXT,
  legitimacy_reasoning     TEXT,
  degree_gated             BOOLEAN NOT NULL DEFAULT FALSE,
  rescored_at              TIMESTAMPTZ,  -- stamped by `jobify-hunt --rescore`

  -- ── link resolution (hunt discovery gate) ───────────────────────────────
  -- application_url + ats_kind are populated early by the discovery gate
  -- (formerly written by the tailor's resolve step). link_status records
  -- how the row was classified: direct | aggregator_unverified | expired.
  application_url          TEXT,
  ats_kind                 TEXT,
  link_status              TEXT,

  -- ── status lifecycle (tailor / submit) ──────────────────────────────────
  -- CHECK constraint asserted below (jobs_status_check) — kept in the
  -- ADD CONSTRAINT form so the cross-repo contract test can parse it.
  status                   TEXT NOT NULL DEFAULT 'discovered',
  status_updated_at        TIMESTAMPTZ,

  -- ── tailored materials (tailor) ─────────────────────────────────────────
  archetype                TEXT,
  archetype_confidence     REAL,
  -- Storage object keys ("{job_id}/resume.pdf", …). Null when no material.
  resume_path              TEXT,
  cover_letter_path        TEXT,         -- plain-text CL body for form-paste
  resume_pdf_path          TEXT,
  cover_letter_pdf_path    TEXT,
  -- Structured JSON of standard application-form fields (identity from the
  -- profile + LLM-drafted narrative answers). The submit prefill reads this.
  form_answers             JSONB,
  -- sha256 over (resume_pdf bytes + CL text) at approval time; lets submit
  -- refuse to act on drifted materials.
  materials_hash           TEXT,

  -- ── submit / pre-fill (stop-at-submit) ──────────────────────────────────
  submission_url           TEXT,         -- resolved ATS apply URL
  prefill_screenshot_path  TEXT,         -- Storage key for the cockpit preview
  prefill_completed_at     TIMESTAMPTZ,
  review_screenshot        TEXT,         -- post-prefill screenshot (cockpit)
  uncertain_fields         JSONB,        -- fields the prefill left for the human
  submission_log           JSONB,        -- last attempt's structured event log
  confidence               REAL,         -- submitter self-assessed readiness 0..1

  -- ── terminal / outcome ──────────────────────────────────────────────────
  applied_at               TIMESTAMPTZ,  -- set ONLY when the human Marks Applied
  submitted_at             TIMESTAMPTZ,  -- alias kept for the cockpit's source of truth
  submission_notes         TEXT,
  application_notes        TEXT,
  failure_reason           TEXT,
  -- What the EMPLOYER did next — a separate axis from the pipeline status.
  response_status          TEXT NOT NULL DEFAULT 'none',
  responded_at             TIMESTAMPTZ,

  CONSTRAINT jobs_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  CONSTRAINT jobs_legitimacy_check
    CHECK (legitimacy IS NULL
           OR legitimacy IN ('high_confidence', 'proceed_with_caution', 'suspicious')),
  CONSTRAINT jobs_response_status_check
    CHECK (response_status IN ('none', 'rejected', 'screen', 'interview', 'offer'))
);

-- Canonical jobs.status CHECK. This list MUST stay in lockstep with
-- jobify/shared/status.json (CANONICAL_STATUSES) — tests/test_status_contract.py
-- pins all three (Python tuple ⇄ status.json ⇄ this constraint). Edit the
-- tuple, regenerate status.json (`python -m jobify.shared.status`), then
-- update this block.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check CHECK (
  status = ANY (ARRAY[
    'discovered',
    'new',
    'approved',
    'preparing',
    'ready_for_review',
    'prefilling',
    'awaiting_human_submit',
    'applied',
    'failed',
    'skipped',
    'expired',
    'ignored'
  ]::text[])
);

CREATE INDEX IF NOT EXISTS idx_jobs_status     ON public.jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_legitimacy ON public.jobs (legitimacy);
CREATE INDEX IF NOT EXISTS idx_jobs_archetype  ON public.jobs (archetype);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════
--  runs — dashboard-triggered pipeline runs
-- ══════════════════════════════════════════════════════════════════════════
-- One row per "Run hunt" / "Run tailor" the dashboard dispatches (and per
-- cron hunt). The RunsPanel inserts a row at click time and the GitHub
-- Actions job (scripts/mark_run.py) transitions it through
-- running → completed/failed, attaching the run URL + a tail-of-log excerpt.

CREATE TABLE IF NOT EXISTS public.runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('hunt', 'tailor', 'tailor_manual')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  triggered_by    TEXT NOT NULL DEFAULT 'dashboard',
  args            JSONB,
  result          JSONB,          -- jobify-tailor-one writes back job_id/status/url
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  log_excerpt     TEXT,
  failure_reason  TEXT,
  github_run_url  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_kind_status_idx ON public.runs (kind, status);
CREATE INDEX IF NOT EXISTS runs_created_at_idx  ON public.runs (created_at DESC);

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════
--  application_attempts — per-submit audit trail
-- ══════════════════════════════════════════════════════════════════════════
-- One row per submit attempt. Every jobs.status transition into the submit
-- phase writes a row here with the evidence. outcome is a DIFFERENT enum
-- from jobs.status (see the contract test's module docstring).

CREATE TABLE IF NOT EXISTS public.application_attempts (
  id                       BIGSERIAL PRIMARY KEY,
  job_id                   TEXT NOT NULL,
  attempt_n                INTEGER NOT NULL,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                 TIMESTAMPTZ,
  outcome                  TEXT,   -- 'submitted' | 'needs_review' | 'failed' | 'in_progress'
  adapter                  TEXT,   -- 'greenhouse' | 'lever' | 'ashby' | 'generic' | ...
  stagehand_session_id     TEXT,
  browserbase_replay_url   TEXT,
  confidence               REAL,
  notes                    JSONB,
  CONSTRAINT attempt_n_positive CHECK (attempt_n > 0),
  CONSTRAINT attempt_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  CONSTRAINT attempt_outcome_valid
    CHECK (outcome IS NULL
           OR outcome IN ('submitted', 'needs_review', 'failed', 'in_progress')),
  UNIQUE (job_id, attempt_n)
);
-- FK to jobs(id) is intentionally omitted: single-user integrity is
-- application-enforced (jobify.db). Add a FK later if the schema hardens.

CREATE INDEX IF NOT EXISTS idx_attempts_job_id  ON public.application_attempts (job_id);
CREATE INDEX IF NOT EXISTS idx_attempts_outcome ON public.application_attempts (outcome);
CREATE INDEX IF NOT EXISTS idx_attempts_started ON public.application_attempts (started_at DESC);

ALTER TABLE public.application_attempts ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════
--  job-materials — private Storage bucket
-- ══════════════════════════════════════════════════════════════════════════
-- Holds generated resume.pdf / cover_letter.pdf / prefill.png / review/*.png
-- under job-materials/{job_id}/. `public = false`: no anon access; the
-- dashboard reads via service-role-signed URLs only.

INSERT INTO storage.buckets (id, name, public)
VALUES ('job-materials', 'job-materials', false)
ON CONFLICT (id) DO NOTHING;
