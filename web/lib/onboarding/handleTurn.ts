import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import type { ChatMessage, InterviewStage, EngineTurnParams, EngineTurnResult } from "../anthropic/interview";
import { ONBOARDING_MODEL } from "../anthropic/client";
import { mergeExtractedUpdates } from "./applyToolCalls";
import { firstMissingIntent, missingFieldsForIntent, isInterviewDone, type IntentKey } from "./checklist";
import { renderFallbackQuestion } from "./intentRegistry";
import { buildProfileDoc, type ExtractedState, type TurnLogEntry } from "../profile/buildDoc";
import { saveSession } from "../db/onboardingSession";
import { upsertProfileDoc } from "../db/profiles";
import { recordOnboardingTurn } from "../db/ledger";
import { seedUserPortals } from "../profile/seedUserPortals";
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
  runTurn: (params: EngineTurnParams) => Promise<EngineTurnResult>;
}

export interface HandleTurnResult {
  assistantText: string;
  stage: InterviewStage;
  done: boolean;
  validation?: { status: "valid" | "invalid"; errors: string[] };
  // INT2: set whenever the deterministic askHint path overrides the model's
  // own phrasing this turn (engine contract point 4) — "no_progress" when
  // the target intent made no progress despite a full round-trip,
  // "retry_exhausted" when the question came back empty/invalid even after
  // one retry. Undefined on an ordinary turn. Return-value field only,
  // never persisted (the real, structured telemetry is `extracted.turn_log`,
  // appended every turn).
  fallback_kind?: "no_progress" | "retry_exhausted";
}

// ONB-A: an explicit Skip button sends this reserved sentinel through the
// normal POST /turn path (not an empty send — the empty-reply guard below
// stays intact for genuine blank sends). Intercepted before the model is
// ever called: zero LLM cost, zero ledger row, deterministic transition.
export const RESUME_SKIP_MESSAGE = "__skip_resume__";
const RESUME_SKIP_DISPLAY_TEXT = "Skipped — using the anchor and range answers instead.";

const DONE_FALLBACK_TEXT =
  'Your profile is built — head to your feed and hit "Run my hunt" to get your first results.';

// ADM-3 Part 2: kept ONLY so `lib/admin/onboardingOverview.ts` (admin
// pages — off-limits this session, per session-prompts/55's collision
// section) keeps compiling and can still best-effort-scan historical
// sessions written by the pre-INT2 engine. The INT2 engine's control flow
// never produces or checks these strings anymore — point 7's `turn_log` is
// the real telemetry going forward; nothing in this file references either
// constant below except this comment.
export const LOOP_BREAKER_QUESTION =
  "What's the one thing I haven't asked about that matters most for your search?";
export const FALLBACK_TEXT_MARKERS = [
  "Have a resume handy? Paste/upload it — or skip, we already have plenty.",
  "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
    "and what's the salary floor below which you won't even look?",
  "Let's capture your range — tell me about the core of your work in a few sentences.",
] as const;

/**
 * INT2 engine contract: `stage` is no longer control flow (the checklist
 * is), but the exact same string union is still persisted and read by code
 * outside this session's surface — `components/onboarding/moduleOrder.ts`'s
 * `isModuleComplete` fallback, the anchor route's re-submission guard, and
 * the sim harness's own types all key off it. Pure derivation, recomputed
 * fresh every turn from `extracted` — never itself a source of truth.
 */
function deriveStage(extracted: ExtractedState): InterviewStage {
  if (isInterviewDone(extracted)) return "done";
  if (missingFieldsForIntent("calibration", extracted).length > 0) return "calibration";
  if (!extracted.resumeResolved) return "resume";
  return "targeting";
}

function intentJustResolved(intent: IntentKey, before: ExtractedState, after: ExtractedState): boolean {
  return missingFieldsForIntent(intent, before).length > 0 && missingFieldsForIntent(intent, after).length === 0;
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
  // ledger row, deterministic transition. cv.md gets synthesized from
  // anchor + calibration later, at buildDoc time. `resumeResolved` (not
  // `extracted.resume`, which stays undefined here on purpose) is the
  // checklist's presence marker for this step.
  if (session.stage === "resume" && userMessage === RESUME_SKIP_MESSAGE) {
    const extracted: ExtractedState = { ...session.extracted, resumeResolved: true };
    const receipt = MODULE_REGISTRY.evidence.receipt(extracted as unknown as Record<string, unknown>);
    const modules = receipt ? markModuleComplete({ modules: session.modules }, "evidence", receipt) : session.modules;

    const nextIntent = firstMissingIntent(extracted);
    const assistantText = nextIntent ? renderFallbackQuestion(nextIntent, extracted) : DONE_FALLBACK_TEXT;
    const newMessages: ChatMessage[] = [
      ...session.messages,
      { role: "user", content: RESUME_SKIP_DISPLAY_TEXT },
      { role: "assistant", content: assistantText },
    ];

    return persistAndReturn({
      admin,
      supabase,
      userId,
      extracted,
      modules,
      newMessages,
      assistantText,
      usages: [],
    });
  }

  const extractedBefore = session.extracted;
  const history: ChatMessage[] = [...session.messages, { role: "user", content: userMessage }];

  // The intent whose fields the user's incoming message is expected to
  // answer — computed from state as of the END of the previous turn, so it
  // always matches whatever the previous turn's `nextIntent` asked about.
  const currentIntent: IntentKey = firstMissingIntent(extractedBefore) ?? "targeting";
  // The hypothetical "what comes after this turn resolves currentIntent" —
  // used only to tell the model what to ask about next; the server never
  // trusts this assumption blindly (see the no-progress override below).
  const nextIntentHypothetical = firstMissingIntent(extractedBefore, { excludeIntent: currentIntent });

  // Fix B (session 57): walk the trailing turn_log entries to see how many
  // consecutive PRIOR turns were stuck on this exact intent, and whether
  // the most recent of them already used the askHint template. Feeds both
  // the two-strike threshold and the anti-repeat alternation below. Stops
  // at the first entry that targeted a different intent or advanced —
  // i.e. only counts the CURRENT unbroken stuck streak.
  const priorTurnLog = extractedBefore.turn_log ?? [];
  let priorStuckStreak = 0;
  let priorTemplateUsesInStreak = 0;
  let lastEntryUsedTemplateForThisIntent = false;
  for (let i = priorTurnLog.length - 1; i >= 0; i--) {
    const entry = priorTurnLog[i];
    if (entry.target_intent !== currentIntent || entry.intent_advanced) break;
    if (i === priorTurnLog.length - 1) lastEntryUsedTemplateForThisIntent = entry.askhint_fallback_used;
    priorStuckStreak++;
    if (entry.askhint_fallback_used) priorTemplateUsesInStreak++;
  }

  let engineResult = await runTurn({ history, extracted: extractedBefore, currentIntent, nextIntent: nextIntentHypothetical });
  const usages = [engineResult.usage];
  let retryUsed = false;

  // Engine contract point 4: an empty/invalid question gets exactly one
  // retry (both calls ledgered) before falling to the deterministic
  // askHint path below. The forced tool call means extraction can still
  // have landed even on a blank-question attempt — never discarded.
  if (engineResult.question.trim() === "") {
    retryUsed = true;
    engineResult = await runTurn({ history, extracted: extractedBefore, currentIntent, nextIntent: nextIntentHypothetical });
    usages.push(engineResult.usage);
  }

  let extracted = mergeExtractedUpdates(extractedBefore, engineResult.extractedUpdates);

  // The authenticated user's real email always wins over whatever the model
  // supplied (or fabricated) — overwrite unconditionally, every turn
  // `identity` exists, per the human-confirmed decision that a hallucinated
  // or mistyped chat email must never reach storage.
  if (extracted.identity) {
    extracted = { ...extracted, identity: { ...extracted.identity, email: userEmail } };
  }

  // Real recompute, post-merge — the only thing that decides `done` and the
  // only thing the assistantText below trusts.
  const targetAfter = firstMissingIntent(extracted);
  const done = targetAfter === null;
  const intentAdvancedThisTurn = targetAfter !== currentIntent;
  const stuckThisTurn = targetAfter !== null && targetAfter === currentIntent;
  const totalStuckStreak = stuckThisTurn ? priorStuckStreak + 1 : 0;

  let assistantText: string;
  let fallbackKind: HandleTurnResult["fallback_kind"];

  // Fix B point 1 (two-strike threshold): the askHint override fires only
  // from the SECOND consecutive stuck round on this intent onward — the
  // first stuck round keeps the model's own phrasing, since that's the
  // correct behavior when the user pushes back or asks a clarifying
  // question rather than genuinely stalling.
  // Fix B point 2 (anti-repeat alternation): if the template already fired
  // last turn for this same intent, this turn keeps the model's phrasing
  // instead — NO-REPEAT must never see the same rendered template text
  // twice in a row.
  if (stuckThisTurn && totalStuckStreak >= 2 && !lastEntryUsedTemplateForThisIntent) {
    // Engine contract point 4's loop-breaker: a full round-trip happened
    // (we asked, the user answered) but currentIntent still isn't fully
    // resolved — the model's `question` (if any) was phrased about the
    // hypothetical next topic, which would be premature to surface. Render
    // a stable, deterministic re-ask instead of drifting to that topic.
    // `attempt` selects a distinct phrasing variant on repeat renders.
    assistantText = renderFallbackQuestion(targetAfter, extracted, priorTemplateUsesInStreak + 1);
    fallbackKind = "no_progress";
  } else if (engineResult.question.trim() === "") {
    // Retry already ran above and still came back blank — no model text to
    // fall back on, so the template fires regardless of the stuck streak.
    assistantText =
      targetAfter !== null ? renderFallbackQuestion(targetAfter, extracted, priorTemplateUsesInStreak + 1) : DONE_FALLBACK_TEXT;
    fallbackKind = "retry_exhausted";
  } else {
    assistantText = engineResult.question.trim();
  }

  // Module-progress glue (unchanged mapping from the v2 machine): only
  // calibration/resume map to a ModuleKey (range/evidence respectively);
  // identity/targeting map to none, same as before INT2.
  let modules: ModulesState = session.modules;
  if (intentJustResolved("calibration", extractedBefore, extracted)) {
    const receipt = MODULE_REGISTRY.range.receipt(extracted as unknown as Record<string, unknown>);
    if (receipt) modules = markModuleComplete({ modules }, "range", receipt);
  }
  if (intentJustResolved("resume", extractedBefore, extracted)) {
    const receipt = MODULE_REGISTRY.evidence.receipt(extracted as unknown as Record<string, unknown>);
    if (receipt) modules = markModuleComplete({ modules }, "evidence", receipt);
  }

  // Engine contract point 7: structured per-turn telemetry, persisted (not
  // inferred from scanning message text).
  const turnLogEntry: TurnLogEntry = {
    intent_keys: Array.from(new Set([currentIntent, ...(nextIntentHypothetical ? [nextIntentHypothetical] : [])])),
    retry_used: retryUsed,
    askhint_fallback_used: fallbackKind !== undefined,
    input_tokens: usages.reduce((sum, u) => sum + u.inputTokens, 0),
    output_tokens: usages.reduce((sum, u) => sum + u.outputTokens, 0),
    ts: new Date().toISOString(),
    target_intent: currentIntent,
    intent_advanced: intentAdvancedThisTurn,
  };
  extracted = { ...extracted, turn_log: [...(extractedBefore.turn_log ?? []), turnLogEntry] };

  const newMessages: ChatMessage[] = [...history, { role: "assistant", content: assistantText }];

  const result = await persistAndReturn({
    admin,
    supabase,
    userId,
    extracted,
    modules,
    newMessages,
    assistantText,
    usages,
  });
  return { ...result, fallback_kind: fallbackKind };
}

interface PersistParams {
  admin: SupabaseClient<Database>;
  supabase: SupabaseClient<Database>;
  userId: string;
  extracted: ExtractedState;
  modules: ModulesState;
  newMessages: ChatMessage[];
  assistantText: string;
  usages: { inputTokens: number; outputTokens: number }[];
}

/**
 * Shared tail for both the resume-skip fast path and the main engine-turn
 * path: bill the ledger, decide done via `isInterviewDone` (the server,
 * always — engine contract point 1), persist, and on completion build +
 * upsert the profile doc and seed portals (fail-open).
 */
async function persistAndReturn(params: PersistParams): Promise<HandleTurnResult> {
  const { admin, supabase, userId, extracted, modules, newMessages, assistantText } = params;

  for (const usage of params.usages) {
    await recordOnboardingTurn(admin, {
      userId,
      model: ONBOARDING_MODEL,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  }

  const stage = deriveStage(extracted);
  const done = isInterviewDone(extracted);
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
    // ADM-3 Part 0: seed portals.yml (dream-company probe + tier pack)
    // right on completion. Fail-open — a seeding error must never break
    // the user's final onboarding turn; both writes above have already
    // landed, so it never acts on stale state.
    try {
      await seedUserPortals(admin, userId);
    } catch (err) {
      console.error("onboarding seedUserPortals failed", { userId, err });
    }
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
