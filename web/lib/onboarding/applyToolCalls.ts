import type { InterviewToolCall } from "../anthropic/interview";
import type { ExtractedState, LocationAndCompensation, TargetingTier } from "../profile/buildDoc";
import type { InterviewStage } from "../anthropic/interview";

export interface ApplyResult {
  extracted: ExtractedState;
  stage: InterviewStage;
  done: boolean;
}

/**
 * Merges the tool calls Claude emitted this turn into the session's
 * accumulated `extracted` state, advancing `stage` as each stage's tool
 * fires. Tool inputs are Anthropic-schema-validated JSON already, so this
 * is a straight merge, not re-validation.
 */
export function applyToolCalls(
  toolCalls: InterviewToolCall[],
  previous: ExtractedState,
  previousStage: InterviewStage
): ApplyResult {
  const extracted: ExtractedState = { ...previous };
  let stage = previousStage;
  let done = false;

  for (const call of toolCalls) {
    switch (call.name) {
      case "record_calibration":
        // Preserve the already-generated `prompts` (set by
        // runCalibrationGeneration before this ingest turn ever fires) —
        // this is a merge into the existing calibration object, not a
        // replacement of it. INTSIM live-run fix: a malformed/incomplete
        // re-call (e.g. a truncated tool call) must fall back to the
        // PREVIOUSLY-recorded field, not a hard default — an invalid
        // field is never evidence the real value should be erased. A
        // genuinely-empty array from the model is still a valid array
        // and is recorded as given, same as before.
        extracted.calibration = {
          ...previous.calibration,
          skills: Array.isArray(call.input.skills) ? (call.input.skills as string[]) : previous.calibration?.skills ?? [],
          evidence: Array.isArray(call.input.evidence)
            ? (call.input.evidence as string[])
            : previous.calibration?.evidence ?? [],
          range_statement:
            typeof call.input.range_statement === "string"
              ? call.input.range_statement
              : previous.calibration?.range_statement,
          background_summary:
            typeof call.input.background_summary === "string"
              ? call.input.background_summary
              : previous.calibration?.background_summary,
        };
        if (stage === "calibration") stage = "resume";
        break;
      case "record_resume":
        extracted.resume = {
          cv_markdown: String(call.input.cv_markdown ?? ""),
          key_technical_skills: Array.isArray(call.input.key_technical_skills)
            ? (call.input.key_technical_skills as string[])
            : undefined,
          background_summary:
            typeof call.input.background_summary === "string" ? call.input.background_summary : undefined,
        };
        // ONB-A: resume now feeds directly into targeting — the old
        // resume -> identity -> targeting chain collapsed once "identity"
        // stopped being its own db stage (0010_onboarding_stage_v2.sql).
        if (stage === "resume") stage = "targeting";
        break;
      case "record_identity": {
        // ONB-A: record_identity fires *during* the targeting stage now
        // (the logistics opener), so it never advances the stage itself —
        // only finish_interview (via record_targeting first) does.
        //
        // INTSIM fix (live bug): a correction turn re-calls record_identity
        // with only the field(s) that changed — the model doesn't reliably
        // restate every field verbatim every time. A wholesale replace here
        // silently destroyed previously-recorded fields (most visibly
        // location_and_compensation) whenever that happened. Merge into
        // `previous.identity`, same pattern as record_calibration below,
        // and merge location_and_compensation one level deeper too since
        // it's the field most likely to be corrected piecemeal (e.g. just
        // target_comp_usd after a new offer).
        const previousLocAndComp = previous.identity?.location_and_compensation;
        const incomingLocAndComp =
          typeof call.input.location_and_compensation === "object" && call.input.location_and_compensation !== null
            ? (call.input.location_and_compensation as LocationAndCompensation)
            : undefined;
        const mergedLocAndComp =
          previousLocAndComp || incomingLocAndComp
            ? { ...previousLocAndComp, ...incomingLocAndComp }
            : undefined;

        extracted.identity = {
          ...previous.identity,
          name: String(call.input.name ?? previous.identity?.name ?? ""),
          email: String(call.input.email ?? previous.identity?.email ?? ""),
          phone: typeof call.input.phone === "string" ? call.input.phone : previous.identity?.phone,
          location_base:
            typeof call.input.location_base === "string" ? call.input.location_base : previous.identity?.location_base,
          linkedin: typeof call.input.linkedin === "string" ? call.input.linkedin : previous.identity?.linkedin,
          website: typeof call.input.website === "string" ? call.input.website : previous.identity?.website,
          github: typeof call.input.github === "string" ? call.input.github : previous.identity?.github,
          location_and_compensation: mergedLocAndComp,
        };
        break;
      }
      case "record_targeting":
        extracted.targeting = {
          tiers: Array.isArray(call.input.tiers) ? (call.input.tiers as TargetingTier[]) : [],
          dream_companies: Array.isArray(call.input.dream_companies) ? (call.input.dream_companies as string[]) : undefined,
          hard_disqualifiers: Array.isArray(call.input.hard_disqualifiers) ? (call.input.hard_disqualifiers as string[]) : [],
          soft_concerns: Array.isArray(call.input.soft_concerns) ? (call.input.soft_concerns as string[]) : [],
          degree_gate: typeof call.input.degree_gate === "string" ? call.input.degree_gate : undefined,
          thesis_summary: String(call.input.thesis_summary ?? ""),
        };
        break;
      case "finish_interview":
        done = true;
        stage = "done";
        break;
    }
  }

  return { extracted, stage, done };
}
