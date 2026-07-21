import type { ExtractedState, LocationAndCompensation, TargetingTier } from "../profile/buildDoc";
import type { IntentKey } from "./checklist";

/**
 * INT2 engine contract point 5: "Extraction preserved, merge-not-replace."
 * Same field-present-and-nonempty-wins, deep-merge semantics the old
 * per-tool-call switch in this file used to apply — just re-keyed to merge
 * a slice of the new `interview_turn` tool's `extracted_updates` object
 * instead of one legacy named tool's `input`. Each merger is a pure
 * function: (previous ExtractedState, this intent's raw update value) ->
 * next ExtractedState.
 */

export function mergeCalibration(prev: ExtractedState, updates: unknown): ExtractedState {
  const input = (updates ?? {}) as Record<string, unknown>;
  const previous = prev.calibration;
  return {
    ...prev,
    // `prompts` is set by runCalibrationGeneration before the ingest turn
    // ever fires — spreading `previous` first preserves it; this is a merge
    // into the existing calibration object, never a replacement of it. A
    // malformed/incomplete update (e.g. a truncated tool call) falls back to
    // the previously-recorded field rather than wiping it to empty; a
    // genuinely-empty array the model gives us is still recorded as given.
    calibration: {
      ...previous,
      skills: Array.isArray(input.skills) ? (input.skills as string[]) : (previous?.skills ?? []),
      evidence: Array.isArray(input.evidence) ? (input.evidence as string[]) : (previous?.evidence ?? []),
      range_statement:
        typeof input.range_statement === "string" ? input.range_statement : previous?.range_statement,
      background_summary:
        typeof input.background_summary === "string" ? input.background_summary : previous?.background_summary,
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
  const cvMarkdown = typeof input.cv_markdown === "string" ? input.cv_markdown.trim() : "";
  const skipped = input.skipped === true;
  if (!cvMarkdown && !skipped) return prev;

  const next: ExtractedState = { ...prev, resumeResolved: true };
  if (cvMarkdown) {
    next.resume = {
      cv_markdown: cvMarkdown,
      key_technical_skills: Array.isArray(input.key_technical_skills)
        ? (input.key_technical_skills as string[])
        : prev.resume?.key_technical_skills,
      background_summary:
        typeof input.background_summary === "string" ? input.background_summary : prev.resume?.background_summary,
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
  const mergedLc =
    newLc || previous?.location_and_compensation ? { ...previous?.location_and_compensation, ...newLc } : undefined;

  return {
    ...prev,
    identity: {
      name: typeof input.name === "string" && input.name !== "" ? input.name : (previous?.name ?? ""),
      email: typeof input.email === "string" && input.email !== "" ? input.email : (previous?.email ?? ""),
      phone: typeof input.phone === "string" ? input.phone : previous?.phone,
      location_base: typeof input.location_base === "string" ? input.location_base : previous?.location_base,
      linkedin: typeof input.linkedin === "string" ? input.linkedin : previous?.linkedin,
      website: typeof input.website === "string" ? input.website : previous?.website,
      github: typeof input.github === "string" ? input.github : previous?.github,
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
      tiers: Array.isArray(input.tiers) ? (input.tiers as TargetingTier[]) : (previous?.tiers ?? []),
      dream_companies: Array.isArray(input.dream_companies)
        ? (input.dream_companies as string[])
        : previous?.dream_companies,
      hard_disqualifiers: Array.isArray(input.hard_disqualifiers)
        ? (input.hard_disqualifiers as string[])
        : (previous?.hard_disqualifiers ?? []),
      soft_concerns: Array.isArray(input.soft_concerns)
        ? (input.soft_concerns as string[])
        : (previous?.soft_concerns ?? []),
      degree_gate: typeof input.degree_gate === "string" ? input.degree_gate : previous?.degree_gate,
      thesis_summary: typeof input.thesis_summary === "string" ? input.thesis_summary : (previous?.thesis_summary ?? ""),
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
