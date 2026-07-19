import { deriveNextModule } from "@/components/onboarding/moduleOrder";
import type { InterviewStage } from "@/components/onboarding/moduleOrder";
import type { ModuleKey, ModulesState } from "./moduleRegistry";

const STALE_THRESHOLD_MINUTES = 30;

/** True once `updatedAt` is strictly more than `thresholdMinutes` in the past. */
export function isStale(updatedAt: string, now: Date, thresholdMinutes = STALE_THRESHOLD_MINUTES): boolean {
  const elapsedMs = now.getTime() - new Date(updatedAt).getTime();
  return elapsedMs > thresholdMinutes * 60 * 1000;
}

const MODULE_LABELS: Record<ModuleKey, string> = {
  anchor: "your role",
  reactions: "your reactions",
  values: "your trade-offs",
  dealbreakers: "dealbreakers",
  range: "calibration",
  energy: "energy",
  environment: "environment",
  trajectory: "trajectory",
  evidence: "evidence",
  voice: "voice",
  metrics: "metrics",
  mirror: "the mirror",
};

export interface WelcomeBackInfo {
  moduleLabel: string;
}

/**
 * The "Welcome back" line's data (UX1_DESIGN.md §2): only shown on a return
 * visit — the session hasn't been touched in over 30 minutes — and only
 * while a module remains to resume into.
 */
export function deriveWelcomeBack(
  modules: ModulesState,
  stage: InterviewStage,
  updatedAt: string | null,
  now: Date
): WelcomeBackInfo | null {
  if (!updatedAt || !isStale(updatedAt, now)) return null;
  const nextKey = deriveNextModule(modules, stage);
  if (!nextKey) return null;
  return { moduleLabel: MODULE_LABELS[nextKey] };
}
