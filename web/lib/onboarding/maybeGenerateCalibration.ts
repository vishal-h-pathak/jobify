import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import type { ChatMessage, InterviewStage, CalibrationGenerationResult } from "../anthropic/interview";
import { CALIBRATION_INTRO_COPY } from "../anthropic/interview";
import { ONBOARDING_MODEL } from "../anthropic/client";
import type { AnchorStageData, ExtractedState } from "../profile/buildDoc";
import { saveSession } from "../db/onboardingSession";
import { recordOnboardingTurn } from "../db/ledger";

export interface CalibrationSessionSnapshot {
  stage: InterviewStage;
  messages: ChatMessage[];
  extracted: ExtractedState;
  status: "in_progress" | "complete";
}

export interface MaybeGenerateCalibrationDeps {
  userId: string;
  session: CalibrationSessionSnapshot;
  supabase: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
  runGeneration: (anchor: AnchorStageData) => Promise<CalibrationGenerationResult>;
}

export interface MaybeGenerateCalibrationResult {
  stage: InterviewStage;
  messages: ChatMessage[];
  status: "in_progress" | "complete";
}

/**
 * ONB-A §2 stage 2: the first time a session lands in 'calibration' with no
 * prompts generated yet, runs the (separate, one-call) calibration
 * generation turn and persists the result — exactly one ledger row, per
 * the "every LLM turn = exactly one ledger row" hard requirement. Called
 * from GET /api/onboarding/state (a lazy side effect, same pattern as that
 * route's existing getOrCreateSession write) so the frontend never has to
 * drive a separate "generate now" action.
 */
export async function maybeGenerateCalibrationPrompts(
  deps: MaybeGenerateCalibrationDeps
): Promise<MaybeGenerateCalibrationResult> {
  const { userId, session, supabase, admin, runGeneration } = deps;
  const unchanged: MaybeGenerateCalibrationResult = {
    stage: session.stage,
    messages: session.messages,
    status: session.status,
  };

  if (session.stage !== "calibration" || session.extracted.calibration?.prompts?.length) {
    return unchanged;
  }

  const anchor = session.extracted.anchor;
  if (!anchor) {
    // Defensive: the anchor route always writes extracted.anchor before
    // flipping stage to 'calibration', so this shouldn't happen — but a
    // state GET must never crash over it.
    return unchanged;
  }

  const generation = await runGeneration(anchor);
  const introText =
    `${CALIBRATION_INTRO_COPY}\n\n` + generation.prompts.map((prompt, i) => `${i + 1}. ${prompt}`).join("\n");

  const messages: ChatMessage[] = [...session.messages, { role: "assistant", content: introText }];
  const extracted: ExtractedState = {
    ...session.extracted,
    calibration: { ...session.extracted.calibration, prompts: generation.prompts },
  };

  await recordOnboardingTurn(admin, {
    userId,
    model: ONBOARDING_MODEL,
    inputTokens: generation.usage.inputTokens,
    outputTokens: generation.usage.outputTokens,
  });

  await saveSession(supabase, userId, {
    messages,
    extracted: extracted as unknown as Record<string, unknown>,
    stage: "calibration",
    status: "in_progress",
  });

  return { stage: "calibration", messages, status: "in_progress" };
}
