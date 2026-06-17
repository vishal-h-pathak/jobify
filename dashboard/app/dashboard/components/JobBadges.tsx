"use client";

/**
 * Badge family — every pill on the register goes through these.
 *
 * One Pill primitive (mono, 10px, tracked, square, hairline) + the
 * semantic wrappers: StatusBadge (four lifecycle tones), TierPill
 * (1 / 1.5 / 2 / 3), LocationBadge, ConfidenceBadge, DegreeGatePill.
 * Per-status ad-hoc styling anywhere else is a bug.
 */

import type { Job, JobStatus } from "../../lib/supabase";
import {
  isInFlight,
  isTerminalMuted,
  LIFECYCLE_STAGES,
  lifecycleStageIndex,
  statusTone,
  STATUS_LABEL,
  type Tone,
} from "../lib/lifecycle";
import { locationBucket, tierKey, type TierKey } from "../lib/format";

const TONE_CLASS: Record<Tone, string> = {
  live: "text-green border-green-dim",
  attention: "text-amber border-amber-dim",
  failed: "text-red border-red-dim",
  dim: "text-ink-dim border-rule",
};

export function Pill({
  tone = "dim",
  dashed,
  pulse,
  title,
  className,
  children,
}: {
  tone?: Tone;
  dashed?: boolean;
  pulse?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={[
        "inline-flex items-center gap-1.5 border px-2 py-0.5",
        "font-mono text-[10px] uppercase tracking-[0.16em] whitespace-nowrap",
        TONE_CLASS[tone],
        dashed ? "border-dashed" : "",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      {pulse && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
        />
      )}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: JobStatus | null }) {
  const s = status ?? "new";
  return (
    <Pill
      tone={statusTone(s)}
      pulse={isInFlight(s)}
      dashed={isTerminalMuted(s)}
    >
      {STATUS_LABEL[s] ?? s}
    </Pill>
  );
}

/** Run statuses share the same four tones. */
export function RunStatusBadge({
  status,
}: {
  status: "pending" | "running" | "completed" | "failed";
}) {
  const tone: Tone =
    status === "failed"
      ? "failed"
      : status === "running"
        ? "live"
        : status === "completed"
          ? "live"
          : "dim";
  return (
    <Pill tone={tone} pulse={status === "running"}>
      {status}
    </Pill>
  );
}

const TIER_TONE: Record<TierKey, { tone: Tone; dashed?: boolean }> = {
  "1": { tone: "live" },
  "1.5": { tone: "live", dashed: true },
  "2": { tone: "attention" },
  "3": { tone: "dim" },
};

export function TierPill({ tier }: { tier: Job["tier"] }) {
  const k = tierKey(tier);
  if (!k) return null;
  const { tone, dashed } = TIER_TONE[k];
  return (
    <Pill tone={tone} dashed={dashed} className="tabular-nums">
      T{k}
    </Pill>
  );
}

export function LocationBadge({
  location,
}: {
  location: string | null | undefined;
}) {
  const bucket = locationBucket(location);
  return (
    <Pill tone={bucket === "local" ? "live" : "dim"}>
      {bucket === "local" ? "local/remote" : "elsewhere"}
    </Pill>
  );
}

/** Tailor/submitter confidence, 0..1. Anything on the review queue is
 *  by definition < 0.8 (the auto threshold), so split inside that. */
export function ConfidenceBadge({ c }: { c: number | null | undefined }) {
  if (c === null || c === undefined) {
    return <Pill tone="dim">no score</Pill>;
  }
  const tone: Tone = c >= 0.7 ? "live" : c >= 0.55 ? "attention" : "failed";
  return (
    <Pill tone={tone} className="tabular-nums">
      {c.toFixed(2)}
    </Pill>
  );
}

/** Amber MS/PhD-gate marker — only rendered when the hunter has the
 *  degree_gated column and flagged this row. */
export function DegreeGatePill({ gated }: { gated: boolean | null | undefined }) {
  if (!gated) return null;
  return (
    <Pill tone="attention" title="Posting requires MS/PhD">
      ms/phd gate
    </Pill>
  );
}

/** Background fills for the lifecycle pill's tone-colored current segment.
 *  TONE_CLASS above is text/border; the pill needs solid bars. */
const TONE_FILL: Record<Tone, string> = {
  live: "bg-green",
  attention: "bg-amber",
  failed: "bg-red",
  dim: "bg-ink-faint",
};

/**
 * LifecyclePill — read-only, compact linear progress marker.
 *
 * Five segments for new → approved → tailored → staged → submitted.
 * Completed segments fill dim, the current one fills its lifecycle tone
 * (pulsing while in-flight), upcoming ones stay hairline. Off-path rows
 * (failed / skipped / ignored / expired) have no stage index, so the
 * whole track renders in the status tone (failed=red bar, terminal-muted
 * =dashed dim) — it can never disagree with StatusBadge because both key
 * off lifecycle.ts. Purely a QOL indicator; it writes nothing.
 */
export function LifecyclePill({ status }: { status: JobStatus | null }) {
  const s = status ?? "new";
  const idx = lifecycleStageIndex(s);
  const tone = statusTone(s);
  const muted = isTerminalMuted(s);
  const inFlight = isInFlight(s);
  const label = STATUS_LABEL[s] ?? s;

  // Off-path (failed / skipped / ignored / expired): no position on the
  // line — render every segment in the status tone so the marker still
  // reads as "not progressing" without faking a stage.
  const offPath = idx === null;
  const a11y = offPath
    ? `lifecycle: ${label}`
    : `lifecycle: ${LIFECYCLE_STAGES[idx].label} (stage ${idx + 1} of ${LIFECYCLE_STAGES.length})`;

  return (
    <span
      role="img"
      aria-label={a11y}
      title={a11y}
      className="inline-flex items-center gap-0.5 align-middle"
    >
      {LIFECYCLE_STAGES.map((stage, i) => {
        const done = idx !== null && i < idx;
        const current = idx !== null && i === idx;
        const fill = offPath
          ? muted
            ? "bg-rule"
            : TONE_FILL[tone]
          : current
            ? TONE_FILL[tone]
            : done
              ? "bg-ink-faint"
              : "bg-rule";
        return (
          <span
            key={stage.key}
            aria-hidden="true"
            className={[
              "h-1 w-3.5",
              fill,
              current && inFlight ? "motion-safe:animate-pulse" : "",
              offPath && muted ? "opacity-60" : "",
            ]
              .join(" ")
              .trim()}
          />
        );
      })}
    </span>
  );
}
