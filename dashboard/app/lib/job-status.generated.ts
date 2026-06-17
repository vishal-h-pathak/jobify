// AUTO-GENERATED from app/lib/job-status.json — do not edit by hand.
// Source of truth: job-pipeline/jobpipe/shared/status.py (Session E).
// Regenerate with `npm run gen:status`; the build prechain
// (scripts/check-status-types.mjs) fails if this file drifts.

export const JOB_STATUSES = [
  "discovered",
  "new",
  "approved",
  "preparing",
  "ready_for_review",
  "prefilling",
  "awaiting_human_submit",
  "applied",
  "failed",
  "skipped",
  "expired",
  "ignored",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
