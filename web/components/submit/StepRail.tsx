"use client";

import { SUBMIT_STEP_ORDER, SUBMIT_STEP_LABELS, stepProgressPercent, type SubmitStepKey } from "./wizard";

/**
 * PhaseRail-style progress (V3C session 39 spec) — a simpler, linear
 * sibling of onboarding's PhaseRail (web/components/onboarding/PhaseRail.tsx):
 * one amber underline, no phase segments (this wizard has no phases, just
 * 5 flat steps), same 400ms width transition.
 */
export function StepRail({ current }: { current: SubmitStepKey }) {
  const percent = stepProgressPercent(current);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 text-xs">
        {SUBMIT_STEP_ORDER.map((key, i) => (
          <span key={key} className={key === current ? "text-ink" : "text-ink-muted"}>
            {String(i + 1).padStart(2, "0")} {SUBMIT_STEP_LABELS[key]}
          </span>
        ))}
      </div>
      <div className="relative h-0.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-amber transition-[width] duration-[400ms] ease-in-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
