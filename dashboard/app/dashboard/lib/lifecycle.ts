/**
 * Lifecycle tones — the register's four-tone status language.
 *
 * Every job status (and run status) maps to exactly one of four tones,
 * matching the notebook's accent semantics:
 *
 *   live       green — positive / system working / done well
 *   attention  amber — a human needs to act
 *   failed     red   — something broke
 *   dim        ink   — quiet (new) or terminal (skipped/ignored/expired)
 *
 * This file is the single source of truth; the visual classes live in
 * components/JobBadges.tsx. No other file may key colors off a status.
 */

import type { JobStatus } from "../../lib/supabase";

export type Tone = "live" | "attention" | "failed" | "dim";

export function statusTone(status: JobStatus | null | undefined): Tone {
  switch (status ?? "new") {
    case "approved":
    case "preparing":
    case "prefilling":
    case "applied":
      return "live";

    case "ready_for_review":
    case "awaiting_human_submit":
      return "attention";

    case "failed":
      return "failed";

    default: // new, discovered, skipped, expired, ignored
      return "dim";
  }
}

/** Statuses where the system is actively working — badges pulse. */
export function isInFlight(status: JobStatus | null | undefined): boolean {
  const s = status ?? "new";
  return s === "preparing" || s === "prefilling";
}

/** Terminal muted states — dashed border, row fades. */
export function isTerminalMuted(status: JobStatus | null | undefined): boolean {
  const s = status ?? "new";
  return s === "skipped" || s === "ignored" || s === "expired";
}

/** A row needs the user's attention right now. Used by the browse view's
 *  "Action needed" section and the global nav badge. */
export function isActionNeeded(status: JobStatus | null | undefined): boolean {
  const s = status ?? "new";
  return (
    s === "ready_for_review" ||
    s === "awaiting_human_submit" ||
    s === "failed"
  );
}

/**
 * Linear lifecycle stages for the read-only progress pill (JobBadges
 * → LifecyclePill). The full status set collapses to five ordered
 * stages a row walks in order:
 *
 *   new → approved → tailored → staged → submitted
 *
 * Off-path states (failed / skipped / ignored / expired) have NO stage
 * index — the pill renders them via statusTone / isTerminalMuted so it
 * never contradicts the badge. This is the single source of truth for
 * stage membership; the pill only renders it.
 */
export const LIFECYCLE_STAGES = [
  { key: "new", label: "new" },
  { key: "approved", label: "approved" },
  { key: "tailored", label: "tailored" },
  { key: "staged", label: "staged" },
  { key: "submitted", label: "submitted" },
] as const;

/** Index into LIFECYCLE_STAGES, or null for off-path terminal/failed
 *  states (failed, skipped, ignored, expired) that aren't on the line. */
export function lifecycleStageIndex(
  status: JobStatus | null | undefined,
): number | null {
  switch (status ?? "new") {
    case "discovered":
    case "new":
      return 0;
    case "approved":
    case "preparing":
      return 1;
    case "ready_for_review":
      return 2;
    case "prefilling":
    case "awaiting_human_submit":
      return 3;
    case "applied":
      return 4;
    default: // failed, skipped, ignored, expired
      return null;
  }
}

export const STATUS_LABEL: Record<string, string> = {
  discovered: "discovered",
  new: "new",
  approved: "approved",
  preparing: "preparing",
  ready_for_review: "review ready",
  prefilling: "pre-filling",
  awaiting_human_submit: "awaiting submit",
  applied: "applied",
  failed: "failed",
  skipped: "skipped",
  expired: "expired",
  ignored: "ignored",
};

/** CSS variable for tone-keyed inline accents (card stripes, chart bars).
 *  `dim` returns null — quiet rows carry no stripe. */
export function toneStripeVar(tone: Tone): string | null {
  switch (tone) {
    case "live":
      return "var(--green)";
    case "attention":
      return "var(--amber)";
    case "failed":
      return "var(--red)";
    case "dim":
      return null;
  }
}
