import type { ModulesState } from "@/lib/onboarding/moduleRegistry";
import {
  CANONICAL_MODULE_ORDER,
  completedModuleCount,
  derivePhaseSegments,
  latestReceipt,
  type InterviewStage,
} from "./moduleOrder";

export interface PhaseRailProps {
  modules: ModulesState;
  stage: InterviewStage;
  /**
   * V3A_DESIGN.md §1.6: as the checkpoint interstitial enters, the rail's
   * amber underline does a full-width sweep-and-settle once — one of the
   * two sanctioned emotional-beat animations. The width transition itself
   * is unchanged (still 400ms ease-in-out); this just layers a one-shot
   * highlight sweep on top.
   */
  sweeping?: boolean;
}

/**
 * V3A_DESIGN.md §1.1: replaces StepSpine. Three segments — Ground truth /
 * Depth / Mirror — each an n/m fraction over its own modules, sharing ONE
 * continuous amber underline whose width is completed/12 across all
 * twelve. Beneath the rail, a single receipt line for the most recently
 * completed module (server-persisted, not client-local — fixes v2's
 * StepSpine, which could only show receipts observed this session).
 */
export function PhaseRail({ modules, stage, sweeping = false }: PhaseRailProps) {
  const segments = derivePhaseSegments(modules, stage);
  const completed = completedModuleCount(modules, stage);
  const progressPercent = (completed / CANONICAL_MODULE_ORDER.length) * 100;
  const receipt = latestReceipt(modules);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 text-xs">
        {segments.map((segment, i) => (
          <div key={segment.phase} className="flex flex-1 flex-col gap-1">
            <span className="text-ink">
              {String(i + 1).padStart(2, "0")} {segment.label}
            </span>
            <span className="text-xs text-ink-muted">
              {segment.completed}/{segment.total}
            </span>
          </div>
        ))}
      </div>
      <div className="relative h-0.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-amber transition-[width] duration-[400ms] ease-in-out"
          style={{ width: `${progressPercent}%` }}
        />
        {sweeping && (
          <div aria-hidden="true" className="rail-sweep absolute inset-y-0 left-0 w-full bg-amber" />
        )}
      </div>
      {receipt && <span className="text-sm text-ink-muted">{receipt}</span>}
    </div>
  );
}
