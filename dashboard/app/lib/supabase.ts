/**
 * Shared dashboard types. This module used to also export a browser
 * Supabase client built on NEXT_PUBLIC_SUPABASE_ANON_KEY; that client
 * was removed in the RLS lockdown — all dashboard data access now goes
 * through /api/dashboard/* routes (service role, dashboard_auth
 * middleware), and the jobs / star_stories / pattern_analyses /
 * application_attempts tables have RLS enabled with no anon policies.
 * Don't reintroduce a client-side Supabase client here.
 */

// JobStatus is GENERATED from the jobpipe canonical enum (Session E) —
// see app/lib/job-status.generated.ts and scripts/gen-status-types.mjs.
// Re-exported here so existing importers keep working. Legacy aliases
// (ready_to_submit / submit_confirmed / submitting / needs_review /
// submitted) were retired by jobpipe migration 011; the CHECK constraint
// is canonical-only and no rows carry them anymore.
import type { JobStatus } from "./job-status.generated";

export { JOB_STATUSES } from "./job-status.generated";
export type { JobStatus } from "./job-status.generated";


/**
 * M-1 form-answer drafts. Identity / contact / location / comp / work-auth
 * / current-employment fields are filled from profile.yml in Python; only
 * the four narrative fields below (and additional_questions) are LLM-
 * drafted. The cockpit (M-6) renders these as copy-paste drafts the
 * human can paste into form fields the per-ATS handler couldn't reach.
 */
export type FormAnswerQuestion = {
  question: string;
  draft_answer: string;
};

export type FormAnswers = {
  // Identity (pulled from profile.yml; never LLM-generated)
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string | null;
  linkedin_url?: string;
  github_url?: string | null;
  portfolio_url?: string;
  // Location & comp
  current_location?: string;
  willing_to_relocate?: string;
  remote_preference?: string;
  salary_expectation?: string;
  work_authorization?: string;
  notice_period?: string;
  availability_to_start?: string;
  // Current employment
  current_company?: string;
  current_title?: string;
  years_of_experience?: number;
  // Narrative (LLM-drafted; constrained word counts)
  why_this_role?: string;
  why_this_company?: string;
  additional_info?: string | null;
  additional_questions?: FormAnswerQuestion[];
};

/**
 * Shape of the `submission_log` JSONB column written by job-submitter's
 * review/packet.py::build_packet. See that module for the source of truth;
 * this type mirrors it for the portfolio dashboard's review queue.
 */
export type FilledField = {
  label: string;
  value: string;
  confidence: number;
  kind: "text" | "select" | "file" | "checkbox" | "radio" | "textarea" | "other";
};

export type SkippedField = {
  label: string;
  reason: string;
};

export type PacketScreenshot = {
  label: string;
  storage_path: string;
};

export type SubmissionPacket = {
  attempt_n: number;
  adapter: string;
  reason: string;
  confidence: number;
  filled_fields: FilledField[];
  skipped_fields: SkippedField[];
  screenshots: PacketScreenshot[];
  stagehand_session_id: string | null;
  browserbase_replay_url: string | null;
  agent_reasoning: string | null;
  review_url: string;
};

export type Job = {
  id: string | number;
  title: string;
  company: string;
  location: string | null;
  // score and tier are TEXT columns in Postgres (the hunter writes
  // strings; tier now includes "1.5"). PostgREST returns them as
  // strings, but older rows / older clients may surface numbers — use
  // the normalizers in app/dashboard/lib/format.ts, never compare raw.
  score: number | string | null;
  tier: number | string | null;
  // Optional hunter column (degree-gate detection). Feature-detected by
  // the list route — absent from the schema means "not gated".
  degree_gated?: boolean | null;
  reasoning: string | null;
  url: string | null;
  source: string | null;
  status: JobStatus | null;
  created_at: string | null;
  status_updated_at: string | null;
  resume_path: string | null;
  cover_letter_path: string | null;
  resume_pdf_path: string | null;
  cover_letter_pdf_path: string | null;
  application_url: string | null;
  application_notes: string | null;
  // Direct-link health for the application URL, written upstream by the
  // hunter/link-verifier (jobpipe migration 013). The submit lane treats
  // `aggregator_unverified` / `expired` as "no usable direct link" and
  // refuses to enqueue — note these rows still carry a non-null
  // application_url, so the link_status check is the only guard that
  // skips them. Fetched in LIST_COLUMNS; widened with `(string & {})` so
  // an unanticipated upstream value still typechecks.
  link_status:
    | "direct"
    | "aggregator_unverified"
    | "expired"
    | (string & {})
    | null;
  // ATS handler the submitter will route to. Deterministic adapters
  // (greenhouse / lever / ashby) are fast and zero-LLM; the rest fall
  // back to the universal agent path. Surfaced on browse cards so the
  // user can predict cost before approving a row.
  ats_kind:
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workday"
    | "icims"
    | "smartrecruiters"
    | "linkedin"
    | "generic"
    | null;
  applied_at: string | null;
  failure_reason: string | null;
  description: string | null;
  notified: boolean | null;
  // Populated by the submitter when an attempt needs human review. Null
  // until the submitter runs or after the reviewer approves/dismisses and
  // the packet is cleared. See SubmissionPacket above for the full shape.
  submission_log: SubmissionPacket | null;
  confidence: number | null;
  // Match Agent conversation persisted from the dashboard chat. Read by
  // the tailor at approval time and surfaced in the LLM prompts as
  // authoritative framing for THIS specific role. Null = no chat yet.
  match_chat: { role: "user" | "assistant"; content: string }[] | null;
  // Posting Legitimacy axis (J-2). Evaluated by the scorer alongside fit
  // but stored separately so it never leaks into the fit score. Surfaces
  // as a colored pill in the review panel — soft warning, not a gate.
  legitimacy: "high_confidence" | "proceed_with_caution" | "suspicious" | null;
  legitimacy_reasoning: string | null;
  // Archetype routing (J-4). Tailor classifies each JD into one of the
  // archetypes defined in profile.yml; persisted here for analytics
  // (/dashboard/insights) and to show the reviewer which lane was used.
  archetype: string | null;
  archetype_confidence: number | null;
  // M-1: form-answer drafts (career-ops Block H). Authoritative source
  // for both the per-ATS DOM handlers and the cockpit's copy-paste UI.
  // Null when score < 6 or the generation step failed.
  form_answers: FormAnswers | null;
  // M-3: stop-at-submit support columns.
  submission_url: string | null;          // resolved real ATS apply URL
  prefill_screenshot_path: string | null; // job-materials/{job_id}/prefill.png
  prefill_completed_at: string | null;    // when the per-ATS handler finished
  submitted_at: string | null;            // when the HUMAN clicked Mark Applied
  submission_notes: string | null;        // free-text notes from the cockpit modal
};
