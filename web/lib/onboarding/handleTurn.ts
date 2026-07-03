import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import type { ChatMessage, InterviewStage, InterviewTurnResult } from "../anthropic/interview";
import { ONBOARDING_MODEL } from "../anthropic/client";
import { applyToolCalls } from "./applyToolCalls";
import { buildProfileDoc, type ExtractedState } from "../profile/buildDoc";
import { saveSession } from "../db/onboardingSession";
import { upsertProfileDoc } from "../db/profiles";
import { recordOnboardingTurn } from "../db/ledger";

export interface SessionSnapshot {
  stage: InterviewStage;
  messages: ChatMessage[];
  extracted: ExtractedState;
  status: "in_progress" | "complete";
}

export interface HandleTurnDeps {
  userId: string;
  userMessage: string;
  session: SessionSnapshot;
  supabase: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
  runTurn: (history: ChatMessage[]) => Promise<InterviewTurnResult>;
}

export interface HandleTurnResult {
  assistantText: string;
  stage: InterviewStage;
  done: boolean;
  validation?: { status: "valid" | "invalid"; errors: string[] };
}

/**
 * The onboarding chat's core per-turn logic, factored out of the route
 * handler so it's directly unit-testable with an injected `runTurn` (mock
 * Anthropic) and mocked db helpers — see `lib/onboarding/handleTurn.test.ts`.
 * One call in here == one Anthropic turn == exactly one `budget_ledger`
 * row, per the H3 session prompt's "every LLM turn" contract.
 */
export async function handleOnboardingTurn(deps: HandleTurnDeps): Promise<HandleTurnResult> {
  const { userId, userMessage, session, supabase, admin, runTurn } = deps;

  if (session.status === "complete") {
    return { assistantText: "Your profile is already built — head to the feed.", stage: "done", done: true };
  }

  const history: ChatMessage[] = [...session.messages, { role: "user", content: userMessage }];
  const turnResult = await runTurn(history);
  const { extracted, stage, done } = applyToolCalls(turnResult.toolCalls, session.extracted, session.stage);
  const newMessages: ChatMessage[] = [...history, { role: "assistant", content: turnResult.assistantText }];

  await recordOnboardingTurn(admin, {
    userId,
    model: ONBOARDING_MODEL,
    inputTokens: turnResult.usage.inputTokens,
    outputTokens: turnResult.usage.outputTokens,
  });

  // onboarding_sessions.extracted is a generic JSONB column (Record<string,
  // unknown> in Database); ExtractedState is the narrower shape this
  // module works with, so it's an intentional widen on write.
  const extractedForStorage = extracted as unknown as Record<string, unknown>;

  let validation: HandleTurnResult["validation"];
  if (done) {
    const doc = buildProfileDoc(extracted);
    validation = await upsertProfileDoc(supabase, userId, doc);
    await saveSession(supabase, userId, {
      messages: newMessages,
      extracted: extractedForStorage,
      stage,
      status: "complete",
    });
  } else {
    await saveSession(supabase, userId, {
      messages: newMessages,
      extracted: extractedForStorage,
      stage,
      status: "in_progress",
    });
  }

  return { assistantText: turnResult.assistantText, stage, done, validation };
}
