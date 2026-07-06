import type { InterviewStage } from "@/lib/anthropic/interview";

export type SpineStepStatus = "complete" | "current" | "upcoming";

export interface SpineStep {
  index: string;
  label: string;
  status: SpineStepStatus;
  receipt?: string;
}

/**
 * Receipts the page tracks locally as each stage is completed *this
 * session* — the wire contract (GET /state, POST /turn) never sends the
 * client `extracted`, so there is no server-side source to derive these
 * from. A resumed session that was already past a step before this page
 * load simply renders that step's checkmark with no receipt text.
 */
export interface SpineReceipts {
  anchor?: string;
  calibration?: string;
  resume?: string;
}

export const SPINE_LABELS = ["Role", "Range", "Resume (optional)", "What you want"] as const;

// Position of each backend stage along the 4-label spine. "identity" is a
// legacy union member (never produced by v2 code, see lib/anthropic/interview.ts)
// kept here purely so a stale row can't crash rendering — it folds into the
// same position as "targeting". "done" resolves past the last index so every
// step reports complete.
const STAGE_POSITION: Record<InterviewStage, number> = {
  anchor: 0,
  calibration: 1,
  resume: 2,
  identity: 3,
  targeting: 3,
  done: 4,
};

const RECEIPT_KEYS = ["anchor", "calibration", "resume"] as const;

export function deriveSpineSteps(stage: InterviewStage, receipts: SpineReceipts = {}): SpineStep[] {
  const currentPosition = STAGE_POSITION[stage];

  return SPINE_LABELS.map((label, i) => {
    const status: SpineStepStatus = i < currentPosition ? "complete" : i === currentPosition ? "current" : "upcoming";
    const receiptKey = RECEIPT_KEYS[i];
    return {
      index: String(i + 1).padStart(2, "0"),
      label,
      status,
      receipt: status === "complete" && receiptKey ? receipts[receiptKey] : undefined,
    };
  });
}

/**
 * The progress spine (ONBOARDING_REDESIGN.md §3): a single amber underline
 * spans the row, its width animating 400ms ease-in-out as the stage
 * advances — not four independent bars. Completed steps collapse to a
 * check + their one-line capture receipt; the badge rail (`Badge`) goes
 * back to being a data chip, unused here.
 */
export function StepSpine({ steps }: { steps: SpineStep[] }) {
  const currentPosition = steps.findIndex((s) => s.status === "current");
  const filledSegments = currentPosition === -1 ? steps.length : steps.filter((s) => s.status === "complete").length + 1;
  const progressPercent = (filledSegments / steps.length) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 text-xs">
        {steps.map((step) => (
          <div key={step.label} className="flex flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5">
              {step.status === "complete" ? (
                <span aria-hidden="true" className="text-amber">
                  ✓
                </span>
              ) : (
                <span className={step.status === "current" ? "text-amber" : "text-ink-muted"}>{step.index}</span>
              )}
              <span className={step.status === "upcoming" ? "text-ink-muted" : "text-ink"}>{step.label}</span>
            </div>
            {step.receipt && <span className="text-ink-muted">{step.receipt}</span>}
          </div>
        ))}
      </div>
      <div className="relative h-0.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-amber transition-[width] duration-[400ms] ease-in-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
