import type { ExtractedState, LocationAndCompensation, TargetingTier } from "../profile/buildDoc";
import type { IntentKey } from "./checklist";
import { isSentinelPlaceholder } from "./checklist";

/**
 * INT2 engine contract point 5: "Extraction preserved, merge-not-replace."
 * Same field-present-and-nonempty-wins, deep-merge semantics the old
 * per-tool-call switch in this file used to apply — just re-keyed to merge
 * a slice of the new `interview_turn` tool's `extracted_updates` object
 * instead of one legacy named tool's `input`. Each merger is a pure
 * function: (previous ExtractedState, this intent's raw update value) ->
 * next ExtractedState.
 */

/** Never-shrink array guard (Fix A, session 57): a present-but-empty array
 *  must not wipe an already-recorded non-empty one — MONOTONIC-STATE's
 *  documented semantic, applied uniformly to every array field, not just
 *  identity's string fields. */
function nonEmptyArrayOr<T>(value: unknown, previous: T[] | undefined): T[] {
  return Array.isArray(value) && value.length > 0 ? (value as T[]) : (previous ?? []);
}

/**
 * Fix C point 3 (session 57): a hallucinated placeholder ("<UNKNOWN>",
 * "N/A", "TBD", ...) must never land in extracted state, nor overwrite an
 * already-recorded real value — same never-shrink spirit as Fix A's array
 * guard, applied to strings the model might invent instead of admitting a
 * field is genuinely unanswered. Permits empty strings through where a
 * given field already accepted them pre-Fix-C (only sentinel content is
 * new-rejected); `nonEmptyNonSentinelStringOr` additionally rejects empty.
 */
function safeStringOr(value: unknown, previous: string | undefined): string | undefined {
  if (typeof value !== "string" || isSentinelPlaceholder(value)) return previous;
  return value;
}

function nonEmptyNonSentinelStringOr(value: unknown, previous: string): string {
  if (typeof value !== "string" || value === "" || isSentinelPlaceholder(value)) return previous;
  return value;
}

/** Drops sentinel-valued string keys from a raw update object entirely, so
 *  spreading it over `previous` can't overwrite a real value with a
 *  placeholder — used for `location_and_compensation`'s nested string
 *  fields, which merge by object-spread rather than a per-field ternary. */
function sanitizeSentinelStrings<T extends Record<string, unknown>>(obj: T | undefined): Partial<T> {
  if (!obj) return {};
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "string" && isSentinelPlaceholder(val)) continue;
    result[key] = val;
  }
  return result as Partial<T>;
}

export function mergeCalibration(prev: ExtractedState, updates: unknown): ExtractedState {
  const input = (updates ?? {}) as Record<string, unknown>;
  const previous = prev.calibration;
  return {
    ...prev,
    // `prompts` is set by runCalibrationGeneration before the ingest turn
    // ever fires — spreading `previous` first preserves it; this is a merge
    // into the existing calibration object, never a replacement of it. A
    // malformed/incomplete update (e.g. a truncated tool call) falls back to
    // the previously-recorded field rather than wiping it to empty; an
    // empty array is treated the same way — never-shrink (Fix A).
    calibration: {
      ...previous,
      skills: nonEmptyArrayOr(input.skills, previous?.skills),
      evidence: nonEmptyArrayOr(input.evidence, previous?.evidence),
      range_statement: safeStringOr(input.range_statement, previous?.range_statement),
      background_summary: safeStringOr(input.background_summary, previous?.background_summary),
    },
  };
}

/**
 * `skipped: true` is the chat-native way to resolve the resume step without
 * uploaded content (the RESUME_SKIP_MESSAGE UI sentinel resolves it even
 * more directly, writing `resumeResolved` itself before any model call —
 * see handleTurn.ts). A call with neither real content nor an explicit skip
 * is a no-op: it must not flip `resumeResolved` early on a turn that didn't
 * actually resolve anything.
 */
export function mergeResume(prev: ExtractedState, updates: unknown): ExtractedState {
  const input = (updates ?? {}) as Record<string, unknown>;
  const rawCvMarkdown = typeof input.cv_markdown === "string" ? input.cv_markdown.trim() : "";
  const cvMarkdown = isSentinelPlaceholder(rawCvMarkdown) ? "" : rawCvMarkdown;
  const skipped = input.skipped === true;
  if (!cvMarkdown && !skipped) return prev;

  const next: ExtractedState = { ...prev, resumeResolved: true };
  if (cvMarkdown) {
    next.resume = {
      cv_markdown: cvMarkdown,
      key_technical_skills: nonEmptyArrayOr(input.key_technical_skills, prev.resume?.key_technical_skills),
      background_summary: safeStringOr(input.background_summary, prev.resume?.background_summary),
    };
  }
  return next;
}

/**
 * MERGE, never replace. The model sometimes re-calls with only a subset of
 * fields (a correction turn); wholesale replacement previously destroyed a
 * real user's already-recorded phone + full location_and_compensation block
 * mid-interview (INTSIM MONOTONIC-STATE fix). A field this update omits
 * keeps its previously recorded value, and `location_and_compensation`
 * itself merges field-by-field for the same reason.
 */
export function mergeIdentity(prev: ExtractedState, updates: unknown): ExtractedState {
  const input = (updates ?? {}) as Record<string, unknown>;
  const previous = prev.identity;
  const newLc =
    typeof input.location_and_compensation === "object" && input.location_and_compensation !== null
      ? (input.location_and_compensation as LocationAndCompensation)
      : undefined;
  // Fix C: sentinel-valued keys in the incoming block are dropped before the
  // spread, so e.g. {target_comp_usd: "TBD"} can't clobber an already-real value.
  const sanitizedNewLc = sanitizeSentinelStrings(newLc as unknown as Record<string, unknown> | undefined);
  const mergedLc =
    newLc || previous?.location_and_compensation
      ? { ...previous?.location_and_compensation, ...sanitizedNewLc }
      : undefined;

  return {
    ...prev,
    identity: {
      name: nonEmptyNonSentinelStringOr(input.name, previous?.name ?? ""),
      email: nonEmptyNonSentinelStringOr(input.email, previous?.email ?? ""),
      phone: safeStringOr(input.phone, previous?.phone),
      location_base: safeStringOr(input.location_base, previous?.location_base),
      linkedin: safeStringOr(input.linkedin, previous?.linkedin),
      website: safeStringOr(input.website, previous?.website),
      github: safeStringOr(input.github, previous?.github),
      location_and_compensation: mergedLc,
    },
  };
}

/**
 * hard_disqualifiers/soft_concerns/degree_gate are accepted (harmless empty
 * defaults) but never targeted by this checklist — the dealbreakers module
 * owns that ground now (U2 item 6). dream_companies is the optional seed,
 * folded into this same intent's schema rather than a separate gating field.
 */
export function mergeTargeting(prev: ExtractedState, updates: unknown): ExtractedState {
  const input = (updates ?? {}) as Record<string, unknown>;
  const previous = prev.targeting;
  return {
    ...prev,
    targeting: {
      tiers: nonEmptyArrayOr<TargetingTier>(input.tiers, previous?.tiers),
      dream_companies: nonEmptyArrayOr(input.dream_companies, previous?.dream_companies),
      hard_disqualifiers: nonEmptyArrayOr(input.hard_disqualifiers, previous?.hard_disqualifiers),
      soft_concerns: nonEmptyArrayOr(input.soft_concerns, previous?.soft_concerns),
      degree_gate: safeStringOr(input.degree_gate, previous?.degree_gate),
      thesis_summary: safeStringOr(input.thesis_summary, previous?.thesis_summary) ?? "",
    },
  };
}

const MERGERS: Record<IntentKey, (prev: ExtractedState, updates: unknown) => ExtractedState> = {
  calibration: mergeCalibration,
  resume: mergeResume,
  identity: mergeIdentity,
  targeting: mergeTargeting,
};

const INTENT_KEYS: readonly IntentKey[] = ["calibration", "resume", "identity", "targeting"];

/**
 * Engine contract point 5's generic merge entry point. `updates` is the
 * forced `interview_turn` tool's `extracted_updates` value: zero or more of
 * the four intent keys, plus an optional `anything_else` object carrying
 * opportunistic captures in the SAME nested shape — routed through the
 * identical per-key mergers via one level of recursion, so a fact the model
 * notices outside this turn's target intent merges no differently than one
 * inside it.
 */
export function mergeExtractedUpdates(
  prev: ExtractedState,
  updates: Record<string, unknown> | null | undefined
): ExtractedState {
  if (!updates || typeof updates !== "object") return prev;

  let next = prev;
  for (const key of INTENT_KEYS) {
    if (updates[key] !== undefined) {
      next = MERGERS[key](next, updates[key]);
    }
  }

  const anythingElse = updates.anything_else;
  if (anythingElse && typeof anythingElse === "object") {
    next = mergeExtractedUpdates(next, anythingElse as Record<string, unknown>);
  }

  return next;
}
