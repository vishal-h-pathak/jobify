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
        // replacement of it.
        extracted.calibration = {
          ...previous.calibration,
          skills: Array.isArray(call.input.skills) ? (call.input.skills as string[]) : [],
          evidence: Array.isArray(call.input.evidence) ? (call.input.evidence as string[]) : [],
          range_statement:
            typeof call.input.range_statement === "string" ? call.input.range_statement : undefined,
          background_summary:
            typeof call.input.background_summary === "string" ? call.input.background_summary : undefined,
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
        // Live-fire fix (2026-07-19): MERGE, never replace. The model
        // sometimes re-calls record_identity later in targeting with only a
        // subset of fields; wholesale replacement destroyed a real user's
        // already-recorded phone + full location_and_compensation block
        // (salary floor included) mid-interview. A field the new call omits
        // keeps its previously recorded value — same posture as
        // record_calibration's prompts-preserving merge above.
        const prev = extracted.identity;
        const newLc =
          typeof call.input.location_and_compensation === "object" && call.input.location_and_compensation !== null
            ? (call.input.location_and_compensation as LocationAndCompensation)
            : undefined;
        const mergedLc =
          newLc || prev?.location_and_compensation
            ? { ...prev?.location_and_compensation, ...newLc }
            : undefined;
        extracted.identity = {
          name: typeof call.input.name === "string" && call.input.name !== "" ? call.input.name : prev?.name ?? "",
          email: typeof call.input.email === "string" && call.input.email !== "" ? call.input.email : prev?.email ?? "",
          phone: typeof call.input.phone === "string" ? call.input.phone : prev?.phone,
          location_base:
            typeof call.input.location_base === "string" ? call.input.location_base : prev?.location_base,
          linkedin: typeof call.input.linkedin === "string" ? call.input.linkedin : prev?.linkedin,
          website: typeof call.input.website === "string" ? call.input.website : prev?.website,
          github: typeof call.input.github === "string" ? call.input.github : prev?.github,
          location_and_compensation: mergedLc,
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
