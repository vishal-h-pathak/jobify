import { MODULE_REGISTRY, type ModuleKey, type ModulesState } from "@/lib/onboarding/moduleRegistry";

export type InterviewStage = "anchor" | "calibration" | "resume" | "identity" | "targeting" | "done";

/**
 * Canonical module order (V3A_DESIGN.md §1.2) — drives `next_module` and the
 * PhaseRail's fraction/tick derivation. Phase membership comes from
 * `MODULE_REGISTRY[key].phase` (frozen) so this list and the rail's three
 * segments can never drift apart; only the *within-phase* ordering is new
 * here.
 */
export const CANONICAL_MODULE_ORDER: readonly ModuleKey[] = [
  "anchor",
  "reactions",
  "values",
  "dealbreakers",
  "energy",
  "environment",
  "trajectory",
  "range",
  "evidence",
  "voice",
  "metrics",
  "mirror",
];

const STAGE_ORDER: readonly InterviewStage[] = ["anchor", "calibration", "resume", "identity", "targeting", "done"];

function stageAtLeast(stage: InterviewStage, floor: InterviewStage): boolean {
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(floor);
}

/**
 * `range`/`evidence` won't get real `modules` entries until B2 wires the
 * `handleTurn` glue (V3A_DESIGN.md §1.7's transition note: `record_calibration`
 * -> markModuleComplete("range"), `record_resume`/skip -> markModuleComplete
 * ("evidence")). Until then, derive their rail completion from the legacy
 * `stage` field, which already advances at exactly those same two moments —
 * `stage` and `modules` advance in parallel; `modules` is the UI truth
 * everywhere else.
 */
export function isModuleComplete(key: ModuleKey, modules: ModulesState, stage: InterviewStage): boolean {
  if (modules[key]) return true;
  if (key === "range") return stageAtLeast(stage, "resume");
  if (key === "evidence") return stageAtLeast(stage, "targeting");
  return false;
}

/** First incomplete module in canonical order, or null once all 12 are done. */
export function deriveNextModule(modules: ModulesState, stage: InterviewStage): ModuleKey | null {
  return CANONICAL_MODULE_ORDER.find((key) => !isModuleComplete(key, modules, stage)) ?? null;
}

export function completedModuleCount(modules: ModulesState, stage: InterviewStage): number {
  return CANONICAL_MODULE_ORDER.filter((key) => isModuleComplete(key, modules, stage)).length;
}

export interface PhaseSegment {
  phase: 1 | 2 | 3;
  label: string;
  completed: number;
  total: number;
}

const PHASE_LABELS: Record<1 | 2 | 3, string> = { 1: "Ground truth", 2: "Depth", 3: "Mirror" };

/** The PhaseRail's three segments — each an n/m fraction over its own keys. */
export function derivePhaseSegments(modules: ModulesState, stage: InterviewStage): PhaseSegment[] {
  return ([1, 2, 3] as const).map((phase) => {
    const keys = CANONICAL_MODULE_ORDER.filter((key) => MODULE_REGISTRY[key].phase === phase);
    const completed = keys.filter((key) => isModuleComplete(key, modules, stage)).length;
    return { phase, label: PHASE_LABELS[phase], completed, total: keys.length };
  });
}

/**
 * The receipt line under the rail: the most recently completed module's
 * receipt, by `completed_at`, not by canonical-order position — a deep-link
 * redo of an earlier module (dossier's "Redo this module") can legitimately
 * become the newest completion again. Stage-derived range/evidence
 * completions never carry a receipt (`noExtractorYet` until B2 ships their
 * extractor), so they're naturally skipped here.
 */
export function latestReceipt(modules: ModulesState): string | null {
  let best: { receipt: string; completedAt: string } | null = null;
  for (const key of CANONICAL_MODULE_ORDER) {
    const entry = modules[key];
    if (!entry) continue;
    if (!best || entry.completed_at > best.completedAt) {
      best = { receipt: entry.receipt, completedAt: entry.completed_at };
    }
  }
  return best?.receipt ?? null;
}
