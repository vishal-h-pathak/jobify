import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import type { ChatMessage, InterviewStage, InterviewTurnResult } from "../anthropic/interview";
import { SEEDED_GREETING } from "../anthropic/interview";
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
  userEmail: string;
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
 * FIX-1 (2026-07-05): deterministic fallback questions, keyed by the stage
 * the turn lands on. Used both when the model returns an empty response
 * (after one retry) and, via the post-check below, when a non-empty
 * response has no question mark in it at all — e.g. a bare "Good, moving
 * on." acknowledgment. `done` has no next question, so it gets a
 * completion line instead.
 */
const STAGE_FALLBACK_QUESTIONS: Record<Exclude<InterviewStage, "done">, string> = {
  resume: "Quick check on what I pulled from your resume — anything wrong or missing?",
  identity:
    "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
    "and what's the salary floor below which you won't even look?",
  targeting:
    "More of what you already do, a senior version of it, or something adjacent — which direction fits, " +
    "or a mix? Pick, combine, or correct.",
};

const DONE_FALLBACK_TEXT =
  'Your profile is built — head to your feed and hit "Run my hunt" to get your first results.';

function fallbackAssistantText(stage: InterviewStage): string {
  return stage === "done" ? DONE_FALLBACK_TEXT : STAGE_FALLBACK_QUESTIONS[stage];
}

/**
 * The onboarding chat's core per-turn logic, factored out of the route
 * handler so it's directly unit-testable with an injected `runTurn` (mock
 * Anthropic) and mocked db helpers — see `lib/onboarding/handleTurn.test.ts`.
 * One call in here == one Anthropic turn == exactly one `budget_ledger`
 * row, per the H3 session prompt's "every LLM turn" contract.
 */
export async function handleOnboardingTurn(deps: HandleTurnDeps): Promise<HandleTurnResult> {
  const { userId, userEmail, userMessage, session, supabase, admin, runTurn } = deps;

  if (session.status === "complete") {
    return { assistantText: "Your profile is already built — head to the feed.", stage: "done", done: true };
  }

  // On the very first real turn (no assistant message has ever been
  // persisted, including the seeded greeting), prepend the seeded greeting
  // so the model sees its own opening line as context and the transcript
  // persists in full on reload. This is a local prepend, not an extra
  // Anthropic call — the single runTurn call below still fires exactly
  // once, and so does the ledger row.
  const priorMessages: ChatMessage[] =
    session.messages.length === 0
      ? [{ role: "assistant", content: SEEDED_GREETING }]
      : session.messages;

  const history: ChatMessage[] = [...priorMessages, { role: "user", content: userMessage }];
  let turnResult = await runTurn(history);

  // FIX-1: a model turn that comes back empty/whitespace-only must never
  // reach the user as a blank bubble. Retry once (still one real attempt at
  // getting substantive text); if it's still empty, the caller below falls
  // back to a deterministic stage-appropriate question. The turn is still
  // billed either way — that's acceptable, the user must just never see
  // nothing.
  if (turnResult.assistantText.trim() === "") {
    turnResult = await runTurn(history);
  }

  const { extracted, stage, done } = applyToolCalls(turnResult.toolCalls, session.extracted, session.stage);

  let assistantText = turnResult.assistantText.trim();
  if (assistantText === "") {
    console.warn("handleOnboardingTurn: empty assistant response survived retry, using stage fallback", {
      userId,
      stage,
    });
    assistantText = fallbackAssistantText(stage);
  } else if (stage !== "done" && !assistantText.includes("?")) {
    // Deterministic post-check (preferred over relying on the prompt alone):
    // a non-empty turn that never asks anything — e.g. a bare "Good, moving
    // on." acknowledgment — gets the next question appended so the user
    // always has something to answer.
    assistantText = `${assistantText} ${fallbackAssistantText(stage)}`;
  }

  const newMessages: ChatMessage[] = [...history, { role: "assistant", content: assistantText }];

  // The authenticated user's real email always wins over whatever the model
  // supplied (or fabricated) via record_identity — overwrite unconditionally,
  // every turn `identity` exists, per the human-confirmed decision that a
  // hallucinated or mistyped chat email must never reach storage.
  if (extracted.identity) {
    extracted.identity = { ...extracted.identity, email: userEmail };
  }

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

  return { assistantText, stage, done, validation };
}
