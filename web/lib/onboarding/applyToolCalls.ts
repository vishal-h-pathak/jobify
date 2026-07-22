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
 *  identity's string fields. Used for OWNING (this turn's target intent)
 *  updates — it may replace with a shorter-but-non-empty array: that is a
 *  legitimate user correction (Fix E, session 58). */
function nonEmptyArrayOr<T>(value: unknown, previous: T[] | undefined): T[] {
  return Array.isArray(value) && value.length > 0 ? (value as T[]) : (previous ?? []);
}

/**
 * Fix E (session 58): an OPPORTUNISTIC (non-owning — routed through
 * `anything_else`, or any top-level key other than the turn's actual
 * target) array touch is fill-only. It lands only when the stored value is
 * absent/empty, and never replaces an already-recorded non-empty array —
 * even with a same-or-shorter-length value that the owning-intent replace
 * above would accept. MONOTONIC-STATE flags any array shrink; Fix A's
 * literal "non-empty always replaces" formula let an opportunistic re-touch
 * on an unrelated turn shrink an already-recorded array and trip it (the
 * live repro: calibration.skills/evidence via an anything_else on an
 * identity/targeting turn).
 */
function fillOnlyArrayOr<T>(value: unknown, previous: T[] | undefined): T[] {
  if (previous && previous.length > 0) return previous;
  return Array.isArray(value) && value.length > 0 ? (value as T[]) : (previous ?? []);
}

/** Dispatches to the owning or opportunistic array-merge rule above. */
function arrayMergeOr<T>(owning: boolean, value: unknown, previous: T[] | undefined): T[] {
  return owning ? nonEmptyArrayOr(value, previous) : fillOnlyArrayOr(value, previous);
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

/** `owning` (Fix E, session 58): true when this update came from the turn's
 *  actual target intent — false for an opportunistic touch via
 *  `anything_else` (or any other non-target top-level key). Defaults to
 *  true so direct callers (this function is also exported for
 *  `intentRegistry.ts` and tested standalone) keep the pre-Fix-E behavior
 *  when they don't care about ownership. */
export function mergeCalibration(prev: ExtractedState, updates: unknown, owning = true): ExtractedState {
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
      skills: arrayMergeOr(owning, input.skills, previous?.skills),
      evidence: arrayMergeOr(owning, input.evidence, previous?.evidence),
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
export function mergeResume(prev: ExtractedState, updates: unknown, owning = true): ExtractedState {
  const input = (updates ?? {}) as Record<string, unknown>;
  const rawCvMarkdown = typeof input.cv_markdown === "string" ? input.cv_markdown.trim() : "";
  const cvMarkdown = isSentinelPlaceholder(rawCvMarkdown) ? "" : rawCvMarkdown;
  const skipped = input.skipped === true;
  if (!cvMarkdown && !skipped) return prev;

  const next: ExtractedState = { ...prev, resumeResolved: true };
  if (cvMarkdown) {
    next.resume = {
      cv_markdown: cvMarkdown,
      key_technical_skills: arrayMergeOr(owning, input.key_technical_skills, prev.resume?.key_technical_skills),
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
export function mergeTargeting(prev: ExtractedState, updates: unknown, owning = true): ExtractedState {
  const input = (updates ?? {}) as Record<string, unknown>;
  const previous = prev.targeting;
  return {
    ...prev,
    targeting: {
      tiers: arrayMergeOr<TargetingTier>(owning, input.tiers, previous?.tiers),
      dream_companies: arrayMergeOr(owning, input.dream_companies, previous?.dream_companies),
      hard_disqualifiers: arrayMergeOr(owning, input.hard_disqualifiers, previous?.hard_disqualifiers),
      soft_concerns: arrayMergeOr(owning, input.soft_concerns, previous?.soft_concerns),
      degree_gate: safeStringOr(input.degree_gate, previous?.degree_gate),
      thesis_summary: safeStringOr(input.thesis_summary, previous?.thesis_summary) ?? "",
    },
  };
}

// mergeIdentity has no array fields (location_and_compensation merges by
// object-spread, not array rules) — wrapped here rather than given its own
// unused `owning` param, so its exported signature stays exactly what
// intentRegistry.ts and existing tests already call.
const MERGERS: Record<IntentKey, (prev: ExtractedState, updates: unknown, owning: boolean) => ExtractedState> = {
  calibration: mergeCalibration,
  resume: mergeResume,
  identity: (prev, updates) => mergeIdentity(prev, updates),
  targeting: mergeTargeting,
};

const INTENT_KEYS: readonly IntentKey[] = ["calibration", "resume", "identity", "targeting"];

/**
 * Engine contract point 5's generic merge entry point. `updates` is the
 * forced `interview_turn` tool's `extracted_updates` value: zero or more of
 * the four intent keys, plus an optional `anything_else` object carrying
 * opportunistic captures in the SAME nested shape.
 *
 * Fix E (session 58): `targetIntent` — the turn's actual target — decides
 * ownership. A top-level key matching it merges as OWNING (may legitimately
 * shrink a non-empty array: a user correction). Every `anything_else` key,
 * and any top-level key that ISN'T the target (defense in depth — the
 * schema should never produce this, but the merge must not trust that
 * blindly), merges as OPPORTUNISTIC: fill-only, never replacing an
 * already-recorded non-empty array. Omitting `targetIntent` treats every
 * top-level key as owning (pre-Fix-E behavior), for callers that don't
 * track a turn's target — `anything_else` stays opportunistic regardless.
 */
export function mergeExtractedUpdates(
  prev: ExtractedState,
  updates: Record<string, unknown> | null | undefined,
  targetIntent?: IntentKey
): ExtractedState {
  if (!updates || typeof updates !== "object") return prev;

  let next = prev;
  for (const key of INTENT_KEYS) {
    if (updates[key] !== undefined) {
      const owning = targetIntent ? key === targetIntent : true;
      next = MERGERS[key](next, updates[key], owning);
    }
  }

  const anythingElse = updates.anything_else;
  if (anythingElse && typeof anythingElse === "object") {
    const anythingElseObj = anythingElse as Record<string, unknown>;
    for (const key of INTENT_KEYS) {
      if (anythingElseObj[key] !== undefined) {
        next = MERGERS[key](next, anythingElseObj[key], false);
      }
    }
  }

  return next;
}
