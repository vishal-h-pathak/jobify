import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import type { ChatMessage, InterviewStage, InterviewTurnResult } from "../anthropic/interview";
import { ONBOARDING_MODEL } from "../anthropic/client";
import { applyToolCalls } from "./applyToolCalls";
import { buildProfileDoc, type ExtractedState } from "../profile/buildDoc";
import { saveSession } from "../db/onboardingSession";
import { upsertProfileDoc } from "../db/profiles";
import { recordOnboardingTurn } from "../db/ledger";
import { markModuleComplete, MODULE_REGISTRY, type ModulesState } from "./moduleRegistry";

export interface SessionSnapshot {
  stage: InterviewStage;
  messages: ChatMessage[];
  extracted: ExtractedState;
  status: "in_progress" | "complete";
  modules: ModulesState;
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

// ONB-A: an explicit Skip button sends this reserved sentinel through the
// normal POST /turn path (not an empty send — the empty-reply guard below
// stays intact for genuine blank sends). Intercepted before the model is
// ever called: zero LLM cost, zero ledger row, deterministic transition.
export const RESUME_SKIP_MESSAGE = "__skip_resume__";
const RESUME_SKIP_DISPLAY_TEXT = "Skipped — using the anchor and range answers instead.";

const RESUME_STAGE_FALLBACK = "Have a resume handy? Paste/upload it — or skip, we already have plenty.";
const TARGETING_STAGE_FALLBACK =
  "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
  "and what's the salary floor below which you won't even look?";
const CALIBRATION_STAGE_GENERIC_FALLBACK =
  "Let's capture your range — tell me about the core of your work in a few sentences.";

const DONE_FALLBACK_TEXT =
  'Your profile is built — head to your feed and hit "Run my hunt" to get your first results.';

/**
 * FIX-1 (2026-07-05), extended for ONB-A's 5-stage machine: deterministic
 * fallback text, keyed by the stage the turn lands on. Used both when the
 * model returns an empty response (after one retry) and, via the
 * post-check below, when a non-empty response has no question mark in it
 * at all. `calibration`'s fallback re-surfaces the first of the four
 * already-generated prompts (extracted.calibration.prompts) rather than a
 * fixed string, since the ingest turn's only real content IS those
 * prompts; `anchor` never reaches a chat turn in v2 (the anchor stage is a
 * zero-LLM form), so it falls back to the targeting text defensively.
 */
function fallbackAssistantText(stage: InterviewStage, extracted: ExtractedState): string {
  switch (stage) {
    case "done":
      return DONE_FALLBACK_TEXT;
    case "calibration":
      return extracted.calibration?.prompts?.[0] ?? CALIBRATION_STAGE_GENERIC_FALLBACK;
    case "resume":
      return RESUME_STAGE_FALLBACK;
    case "targeting":
    case "anchor":
    default:
      return TARGETING_STAGE_FALLBACK;
  }
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

  // ONB-A: the resume stage's explicit Skip button — zero LLM call, zero
  // ledger row, deterministic transition straight to targeting. cv.md gets
  // synthesized from anchor + calibration later, at buildDoc time.
  if (session.stage === "resume" && userMessage === RESUME_SKIP_MESSAGE) {
    const assistantText = TARGETING_STAGE_FALLBACK;
    const newMessages: ChatMessage[] = [
      ...session.messages,
      { role: "user", content: RESUME_SKIP_DISPLAY_TEXT },
      { role: "assistant", content: assistantText },
    ];
    // extracted.resume is never set on this path — evidenceReceipt falls
    // through to the calibration-present branch and returns "built from
    // your answers" — so mark evidence complete unconditionally; skipping
    // the resume upload is always a valid completion of the evidence
    // module (cv.md is synthesized from anchor + calibration later).
    const modules = markModuleComplete({ modules: session.modules }, "evidence", "built from your answers");
    await saveSession(supabase, userId, {
      messages: newMessages,
      extracted: session.extracted as unknown as Record<string, unknown>,
      stage: "targeting",
      status: "in_progress",
      modules,
    });
    return { assistantText, stage: "targeting", done: false };
  }

  // ONB-A: the calibration-generation turn (runCalibrationGeneration,
  // triggered from GET /state) already appends the opening assistant
  // message before any user turn reaches here, so there is no seeded
  // greeting to prepend anymore — session.messages is the full history.
  const history: ChatMessage[] = [...session.messages, { role: "user", content: userMessage }];
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

  // V3A-B2: mark range/evidence complete when their tool calls land this
  // turn. `{ modules }` matches markModuleComplete's `{ modules: ModulesState
  // }` signature (it only reads `.modules`) — chain by threading the local
  // variable through, same pattern as every existing module route. Left
  // untouched (== session.modules) on a turn that fires neither tool, so a
  // later read via getOrCreateSession stays accurate.
  let modules: ModulesState = session.modules;
  const firedCalibration = turnResult.toolCalls.some((c) => c.name === "record_calibration");
  const firedResume = turnResult.toolCalls.some((c) => c.name === "record_resume");
  if (firedCalibration) {
    const receipt = MODULE_REGISTRY.range.receipt(extracted as unknown as Record<string, unknown>);
    if (receipt) modules = markModuleComplete({ modules }, "range", receipt);
  }
  if (firedResume) {
    const receipt = MODULE_REGISTRY.evidence.receipt(extracted as unknown as Record<string, unknown>);
    if (receipt) modules = markModuleComplete({ modules }, "evidence", receipt);
  }

  let assistantText = turnResult.assistantText.trim();
  if (assistantText === "") {
    console.warn("handleOnboardingTurn: empty assistant response survived retry, using stage fallback", {
      userId,
      stage,
    });
    assistantText = fallbackAssistantText(stage, extracted);
  } else if (stage !== "done" && !assistantText.includes("?")) {
    // Deterministic post-check (preferred over relying on the prompt alone):
    // a non-empty turn that never asks anything — e.g. a bare "Good, moving
    // on." acknowledgment — gets the next question appended so the user
    // always has something to answer.
    assistantText = `${assistantText} ${fallbackAssistantText(stage, extracted)}`;
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
      modules,
    });
  } else {
    await saveSession(supabase, userId, {
      messages: newMessages,
      extracted: extractedForStorage,
      stage,
      status: "in_progress",
      modules,
    });
  }

  return { assistantText, stage, done, validation };
}
