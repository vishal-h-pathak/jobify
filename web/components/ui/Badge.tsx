import type { ReactNode } from "react";

export type BadgeTone = "amber" | "blue" | "neutral" | "success" | "danger";

const TONE_CLASSES: Record<BadgeTone, string> = {
  amber: "border-amber/30 bg-amber/15 text-amber",
  blue: "border-badge-blue/30 bg-badge-blue/15 text-badge-blue",
  neutral: "border-line bg-ink-muted/10 text-ink-muted",
  success: "border-success/30 bg-success/15 text-success",
  danger: "border-danger/30 bg-danger/15 text-danger",
};

/** Score badge tiers: >=0.75 amber, 0.5-0.75 muted blue, below that neutral gray. */
export function scoreTone(score: number | null): BadgeTone {
  if (score === null) return "neutral";
  if (score >= 0.75) return "amber";
  if (score >= 0.5) return "blue";
  return "neutral";
}

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
