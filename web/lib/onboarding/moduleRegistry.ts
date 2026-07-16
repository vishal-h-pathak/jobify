/**
 * V3A-1 pinned contract (session-prompts/30_v3a_spine.md, shared verbatim
 * with session-prompts/31_v3a_modules.md — do not deviate from the
 * `ModuleKey` union or the exported function signatures below without
 * updating both prompts).
 *
 * The v2 linear onboarding stage machine (anchor -> calibration -> resume
 * -> targeting -> done) generalizes here into a module-progress model:
 * twelve independently-completable modules across three phases. Progress
 * lives in `onboarding_sessions.modules` (jsonb, migration 0011), separate
 * from the legacy `stage` column so the v2 UI keeps working untouched.
 */

export type ModuleKey =
  | "anchor"
  | "reactions"
  | "values"
  | "dealbreakers" // phase 1
  | "range"
  | "energy"
  | "environment"
  | "trajectory"
  | "evidence"
  | "voice"
  | "metrics" // phase 2
  | "mirror"; // phase 3

export interface ModuleCompletion {
  completed_at: string; // ISO timestamp
  receipt: string;
}

/**
 * `onboarding_sessions.modules` jsonb shape. `checkpoint_hunt` is not a
 * `ModuleKey` — it's `checkpoint.ts`'s own idempotency marker, stamped
 * once `phaseOneComplete` fires the background hunt (see checkpoint.ts).
 */
export type ModulesState = Partial<Record<ModuleKey, ModuleCompletion>> & {
  checkpoint_hunt?: { fired_at: string };
};

export interface ModuleDefinition {
  key: ModuleKey;
  phase: 1 | 2 | 3;
  /** one-line spine receipt derived from extracted, e.g. "{title} · {company}" */
  receipt: (extracted: Record<string, unknown>) => string | null;
}

const PHASE_ONE_KEYS: readonly ModuleKey[] = ["anchor", "reactions", "values", "dealbreakers"];

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// ── phase 1 — real receipts, built this wave ─────────────────────────────

function anchorReceipt(extracted: Record<string, unknown>): string | null {
  const title = asTrimmedString(extracted.current_title);
  const company = asTrimmedString(extracted.current_company);
  if (title && company) return `${title} · ${company}`;
  if (title) return title;
  const freeText = asTrimmedString(extracted.free_text);
  return freeText || null;
}

function reactionsReceipt(extracted: Record<string, unknown>): string | null {
  const reactions = asArray(extracted.reactions);
  if (!reactions.length) return null;
  const interested = reactions.filter(
    (r) => r && typeof r === "object" && (r as Record<string, unknown>).reaction === "interested"
  ).length;
  return `${pluralize(reactions.length, "reaction")} (${interested} interested)`;
}

function valuesReceipt(extracted: Record<string, unknown>): string | null {
  const choices = asArray(extracted.choices);
  if (!choices.length) return null;
  return `${pluralize(choices.length, "trade-off")} answered`;
}

function dealbreakersReceipt(extracted: Record<string, unknown>): string | null {
  const hard = asArray(extracted.hard_disqualifiers);
  if (!hard.length) return "no hard constraints";
  return pluralize(hard.length, "hard constraint");
}

// ── phase 2 — real receipts for the modules 31 builds this wave ─────────

function energyReceipt(extracted: Record<string, unknown>): string | null {
  const hoursDisappear = asTrimmedString(extracted.hours_disappear);
  const keptPuttingOff = asTrimmedString(extracted.kept_putting_off);
  if (!hoursDisappear && !keptPuttingOff) return null;
  return hoursDisappear || keptPuttingOff;
}

function environmentReceipt(extracted: Record<string, unknown>): string | null {
  const choices = asArray(extracted.choices);
  if (!choices.length) return null;
  return `${pluralize(choices.length, "environment preference")}`;
}

function trajectoryReceipt(extracted: Record<string, unknown>): string | null {
  return asTrimmedString(extracted.direction) || null;
}

// ── phase 2/3 — no extractor exists yet this wave; null until it does ───

function noExtractorYet(): string | null {
  return null;
}

export const MODULE_REGISTRY: Record<ModuleKey, ModuleDefinition> = {
  anchor: { key: "anchor", phase: 1, receipt: anchorReceipt },
  reactions: { key: "reactions", phase: 1, receipt: reactionsReceipt },
  values: { key: "values", phase: 1, receipt: valuesReceipt },
  dealbreakers: { key: "dealbreakers", phase: 1, receipt: dealbreakersReceipt },
  range: { key: "range", phase: 2, receipt: noExtractorYet },
  energy: { key: "energy", phase: 2, receipt: energyReceipt },
  environment: { key: "environment", phase: 2, receipt: environmentReceipt },
  trajectory: { key: "trajectory", phase: 2, receipt: trajectoryReceipt },
  evidence: { key: "evidence", phase: 2, receipt: noExtractorYet },
  voice: { key: "voice", phase: 2, receipt: noExtractorYet },
  metrics: { key: "metrics", phase: 2, receipt: noExtractorYet },
  mirror: { key: "mirror", phase: 3, receipt: noExtractorYet },
};

/**
 * Pure updater: marks `key` complete with `receipt`, leaving every other
 * module's completion (and `checkpoint_hunt`) untouched. Safe to call
 * repeatedly for the same key — it overwrites that key's entry rather than
 * accumulating duplicates, since `modules` is a keyed map, not a log.
 */
export function markModuleComplete(session: { modules: ModulesState }, key: ModuleKey, receipt: string): ModulesState {
  return {
    ...session.modules,
    [key]: { completed_at: new Date().toISOString(), receipt },
  };
}

/** Phase 1 gate: anchor + reactions + values + dealbreakers all complete. */
export function phaseOneComplete(modules: ModulesState): boolean {
  return PHASE_ONE_KEYS.every((key) => Boolean(modules[key]));
}
