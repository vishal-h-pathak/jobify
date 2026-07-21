import type { ExtractedState } from "../profile/buildDoc";
import type { ModuleKey } from "./moduleRegistry";

/**
 * INT2 engine contract point 1 (session-prompts/55_int2_engine.md): "the
 * SERVER owns all control flow." `IntentKey` names the four things the
 * chat still needs from the user (anchor is a zero-LLM form, done before
 * this chat starts; every other module — reactions/values/dealbreakers/
 * energy/environment/trajectory/voice/metrics/mirror — is a dedicated
 * module route, not this session's surface). Each key doubles as the
 * top-level `extracted`/`extracted_updates` property name it owns, so the
 * generic merge in `applyToolCalls.ts` needs no separate key-mapping table.
 */
export type IntentKey = "calibration" | "resume" | "identity" | "targeting";

export interface FieldSpec {
  /** Stable id for this field, used only for test readability/debugging. */
  key: string;
  /** Dot-path into `ExtractedState` this field's presence is checked at. */
  extractedPath: string;
  /** Which module-progress key this field's completion feeds, if any —
   *  identity/targeting fields map to no module, same as the v2 machine. */
  module?: ModuleKey;
  /** Exactly one intent owns each field — kills the cross-module double-ask
   *  (U2 item 6): energy/trajectory/values/dealbreakers signals are owned
   *  by their own dedicated modules and never appear in this checklist. */
  intent: IntentKey;
  required: boolean;
  /** Short noun-phrase fragment describing what this field needs — composed
   *  by `intentRegistry.ts` into both the live prompt's "what to ask" guidance
   *  and the deterministic askHint fallback question. */
  askHint: string;
}

/**
 * Derived from what `buildProfileDoc` (`lib/profile/buildDoc.ts`) actually
 * consumes — not the old anchor->calibration->resume->targeting->done stage
 * machine. `hard_disqualifiers`/`soft_concerns`/`degree_gate`/
 * `dream_companies` are deliberately absent: the dealbreakers module now
 * owns hard/soft constraints, and dream_companies is an optional seed folded
 * into the `targeting` intent's schema (never a gating field — see
 * intentRegistry.ts).
 */
export const INTERVIEW_CHECKLIST: FieldSpec[] = [
  {
    key: "calibration_skills",
    extractedPath: "calibration.skills",
    module: "range",
    intent: "calibration",
    required: true,
    askHint: "a flat list of skills mentioned across their four calibration answers",
  },
  {
    key: "calibration_evidence",
    extractedPath: "calibration.evidence",
    module: "range",
    intent: "calibration",
    required: true,
    askHint: "one or two concrete evidence bullets they'd actually show someone",
  },
  {
    key: "calibration_range_statement",
    extractedPath: "calibration.range_statement",
    module: "range",
    intent: "calibration",
    required: true,
    askHint: "their range/realignment answer, close to verbatim",
  },
  {
    key: "calibration_background_summary",
    extractedPath: "calibration.background_summary",
    module: "range",
    intent: "calibration",
    required: true,
    askHint: "a 2-4 sentence background summary written the way they'd describe themselves to a peer",
  },
  {
    key: "resume_resolved",
    extractedPath: "resumeResolved",
    module: "evidence",
    intent: "resume",
    required: true,
    askHint: "whether they have a resume to paste/upload, or want to skip",
  },
  {
    key: "identity_name",
    extractedPath: "identity.name",
    intent: "identity",
    required: true,
    askHint: "their name",
  },
  {
    key: "identity_logistics",
    extractedPath: "identity.location_and_compensation",
    intent: "identity",
    required: true,
    askHint: "where they're based, remote-only or onsite (and where), and their salary floor",
  },
  {
    key: "targeting_tiers",
    extractedPath: "targeting.tiers",
    intent: "targeting",
    required: true,
    askHint: "2-3 concrete next-role directions/tiers built from their actual background",
  },
  {
    key: "targeting_thesis_summary",
    extractedPath: "targeting.thesis_summary",
    intent: "targeting",
    required: true,
    askHint: "a one-paragraph judgment thesis synthesizing what they're optimizing for in this search",
  },
];

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/**
 * Fix C (session 57): placeholder/sentinel strings the model must never
 * invent in place of real user-supplied data — a hallucinated "<UNKNOWN>"
 * for `identity.name` previously satisfied `isFieldPresent` and let the
 * interview complete with garbage stored as a real name. Mirrored by the
 * matching prompt hard-rule (interview.ts) and the mergers' guard
 * (applyToolCalls.ts) — this list is the single source of truth for all
 * three layers.
 */
export const SENTINEL_PLACEHOLDER_VALUES = [
  "unknown",
  "n/a",
  "na",
  "tbd",
  "not provided",
  "not specified",
  "none provided",
  "none given",
] as const;

/** Case-insensitive, bracket/angle/brace-stripped match against the sentinel list. */
export function isSentinelPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const stripped = value
    .trim()
    .toLowerCase()
    .replace(/^[<[{]+|[>\]}]+$/g, "")
    .trim();
  return (SENTINEL_PLACEHOLDER_VALUES as readonly string[]).includes(stripped);
}

/** Presence, not truthiness: an explicit `false` or `0` still counts as answered. */
export function isFieldPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0 && !isSentinelPlaceholder(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export interface MissingFieldsOptions {
  /** Pretend every field owned by this intent is already present — used to
   *  compute "what comes after this turn resolves its current target"
   *  without knowing the turn's actual extraction result yet. */
  excludeIntent?: IntentKey;
}

/** Pure function — checklist order, so callers get a stable "first missing" read. */
export function missingFields(extracted: ExtractedState, opts: MissingFieldsOptions = {}): FieldSpec[] {
  return INTERVIEW_CHECKLIST.filter((field) => {
    if (opts.excludeIntent && field.intent === opts.excludeIntent) return false;
    return !isFieldPresent(getByPath(extracted, field.extractedPath));
  });
}

/** `done ⇔ no required field missing` — the server decides, always (engine contract point 1). */
export function isInterviewDone(extracted: ExtractedState): boolean {
  return missingFields(extracted).every((field) => !field.required);
}

/** The intent whose fields are the first (in checklist order) still missing, or null once nothing required remains. */
export function firstMissingIntent(extracted: ExtractedState, opts: MissingFieldsOptions = {}): IntentKey | null {
  const missing = missingFields(extracted, opts).filter((field) => field.required);
  return missing[0]?.intent ?? null;
}

export function fieldsForIntent(intent: IntentKey): FieldSpec[] {
  return INTERVIEW_CHECKLIST.filter((field) => field.intent === intent);
}

export function missingFieldsForIntent(intent: IntentKey, extracted: ExtractedState): FieldSpec[] {
  return missingFields(extracted).filter((field) => field.intent === intent);
}
