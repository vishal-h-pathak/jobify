import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, ONBOARDING_MODEL } from "./client";
import type { AnchorStageData, ExtractedState } from "../profile/buildDoc";
import type { IntentKey } from "../onboarding/checklist";
import { INTENT_REGISTRY, buildExtractedUpdatesSchema } from "../onboarding/intentRegistry";

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// ONB-A (2026-07-05): v2 stage machine — anchor -> calibration -> resume
// (optional) -> targeting -> done. INT2 (session 55) retired the model-
// driven turn logic these stage names used to gate, but the STRING VALUES
// stay: `components/onboarding/moduleOrder.ts`, the anchor route, and the
// sim harness all key off this exact union, and handleTurn.ts still derives
// one every turn (from the checklist, not a model signal) purely for their
// backward-compat benefit.
export type InterviewStage = "anchor" | "calibration" | "resume" | "targeting" | "done";

/**
 * Legacy: the v1 resume-first opener. Never produced by v2+ code — the
 * calibration-generation turn (`runCalibrationGeneration`) now owns the
 * conversation's opening beat. Kept exported only because
 * `web/app/(app)/onboarding/page.tsx` (session B's territory) still
 * imports it; remove once session B lands its rebuild.
 */
export const SEEDED_GREETING =
  "Welcome. Paste your resume (or upload a .txt/.md) and we'll get through " +
  "this fast — a few pointed questions after, about five minutes total.";

const TONE_RULES =
  `TONE RULES (hard constraint): direct, second person, no exclamation marks. Never use these words or ` +
  `phrases: "passion", "dream", "journey", "fulfilling", "lights you up", "calling", "purpose". Every ` +
  `question you write must be answerable in one short message.`;

// Fix C point 1 (session 57): a live sim run caught the model writing
// "<UNKNOWN>" into `extracted_updates.identity.name` after the user twice
// deflected the name question — that value then silently satisfied the
// checklist's presence check and the interview completed with a garbage
// name on file. checklist.ts's isFieldPresent and applyToolCalls.ts's
// mergers now reject these values server-side (layers 2 and 3 of the fix);
// this is layer 1, stopping the model from writing them in the first place.
const NO_PLACEHOLDER_RULE =
  `NEVER INVENT PLACEHOLDER VALUES (hard constraint): if the user hasn't actually told you a field, OMIT that ` +
  `field from extracted_updates entirely — never write "unknown", "N/A", "TBD", "<UNKNOWN>", "not provided", ` +
  `or any similar placeholder as a value. An omitted field stays correctly unanswered; a placeholder string ` +
  `gets stored as if it were real.`;

/**
 * Dumps everything already known into the prompt so the model structurally
 * cannot re-ask it (U2 items 4/5/7 — extraction-blind questioning and the
 * canned re-prompt loop both die here, per the engine contract's point 3).
 */
function knownContextLines(extracted: ExtractedState): string[] {
  const lines: string[] = [];
  if (extracted.anchor?.current_title) {
    const company = extracted.anchor.current_company ? ` at ${extracted.anchor.current_company}` : "";
    const tenure = extracted.anchor.years_in_role ? ` (${extracted.anchor.years_in_role})` : "";
    lines.push(`- Current/most recent role: ${extracted.anchor.current_title}${company}${tenure}`);
  } else if (extracted.anchor?.free_text) {
    lines.push(`- Situation: ${extracted.anchor.free_text}`);
  }
  if (extracted.calibration?.background_summary) {
    lines.push(`- Background: ${extracted.calibration.background_summary}`);
  }
  if (extracted.calibration?.skills?.length) {
    lines.push(`- Known skills: ${extracted.calibration.skills.join(", ")}`);
  }
  if (extracted.resume?.cv_markdown) {
    lines.push(`- A resume was provided — do not ask for it, or for anything it already covers, again.`);
  } else if (extracted.resumeResolved) {
    lines.push(`- Resume was skipped — do not ask about it again.`);
  }
  if (extracted.identity?.name) lines.push(`- Name: ${extracted.identity.name}`);
  if (extracted.identity?.location_and_compensation) {
    lines.push(`- Logistics already known: ${JSON.stringify(extracted.identity.location_and_compensation)}`);
  }
  return lines;
}

export interface BuildEngineSystemPromptParams {
  /** The intent whose answer the user's latest message is expected to supply. */
  currentIntent: IntentKey;
  /** The intent to phrase a question about next, or null once nothing required remains. */
  nextIntent: IntentKey | null;
  extracted: ExtractedState;
}

/**
 * INT2 engine contract point 3: "the prompt tells the model WHAT to ask
 * (intent + askHint + relevant extracted context so it never re-asks what's
 * known); the model decides only HOW to phrase it." Rebuilt fresh every
 * turn from the server-computed target — there is no static prompt anymore.
 */
export function buildEngineSystemPrompt(params: BuildEngineSystemPromptParams): string {
  const { currentIntent, nextIntent, extracted } = params;
  const current = INTENT_REGISTRY[currentIntent];
  const known = knownContextLines(extracted);

  const neverReAsk = known.length
    ? " NEVER RE-ASK KNOWN FIELDS (hard constraint): never ask for anything already listed under KNOWN CONTEXT below."
    : "";
  const askInstruction = nextIntent
    ? `Then write \`question\`: a single, direct question asking about ${INTENT_REGISTRY[nextIntent].askGuidance(extracted)}.${neverReAsk}`
    : `There is nothing left to ask. Instead of a question, write \`question\` as a short plain-words closing ` +
      `summary of the profile you've built — what you'll rank up, what you'll filter out, a one-line logistics ` +
      `recap — ending with exactly this sentence: "Head to your feed and hit \\"Run my hunt\\" to get your first results."`;

  const sections = [
    `You are interviewing a new user to build their jobify hunting profile — a job-search targeting profile, NOT ` +
      `a job application. You are a sharp, direct career coach who reads everything already gathered about them ` +
      `closely and asks pointed, specific questions grounded in it — never generic filler, never anything already answered.`,
    TONE_RULES,
    NO_PLACEHOLDER_RULE,
    `You must call the \`interview_turn\` tool exactly once, every turn — there is no other valid response. ` +
      `Extract into \`extracted_updates.${currentIntent}\` whatever the user's last message reveals: ${current.extractionGuidance}`,
    `If the user's message also reveals something else useful outside "${currentIntent}", put it in ` +
      `\`extracted_updates.anything_else\` using the same nested shape (e.g. {"identity": {"location_base": "Denver, CO"}}) ` +
      `— never invent content that wasn't actually said.`,
    askInstruction,
  ];
  if (known.length) {
    sections.push(`KNOWN CONTEXT (already recorded — never re-ask any of this):\n${known.join("\n")}`);
  }
  return sections.join("\n\n");
}

/** The forced tool's dynamic `extracted_updates` schema, scoped to this turn's current target (point 2). */
export function buildEngineTool(currentIntent: IntentKey): Anthropic.Tool {
  return {
    name: ENGINE_TOOL_NAME,
    description:
      "Record this turn's extraction into extracted_updates and the single next question (or, once nothing " +
      "remains, a closing summary) to show the user, in `question`.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The single next question to ask the user — or, once nothing remains, a closing summary.",
        },
        extracted_updates: buildExtractedUpdatesSchema(currentIntent),
      },
      required: ["question", "extracted_updates"],
    },
  };
}

/**
 * INT2 engine contract point 2: one tool, `interview_turn`, forced via
 * `tool_choice` — there are zero unforced calls in the new engine, which
 * eliminates the empty-turn failure mode BY CONSTRUCTION (it only ever bit
 * unforced calls).
 */
export const ENGINE_TOOL_NAME = "interview_turn";

// The new per-turn schema only ever targets one intent's fields (plus
// anything_else) rather than the old mega record_targeting call (tiers +
// disqualifiers + thesis + finish_interview + a closing paragraph all in
// one shot), so the payload this cap has to hold is inherently smaller —
// engine contract point 2 pins this at 4096.
export const ENGINE_MAX_TOKENS = 4096;

export interface EngineTurnParams {
  history: ChatMessage[];
  extracted: ExtractedState;
  currentIntent: IntentKey;
  nextIntent: IntentKey | null;
}

export interface EngineTurnResult {
  question: string;
  extractedUpdates: Record<string, unknown>;
  usage: { inputTokens: number; outputTokens: number };
  maxTokens?: number;
}

export async function runEngineTurn(params: EngineTurnParams): Promise<EngineTurnResult> {
  const { history, extracted, currentIntent, nextIntent } = params;
  const response = await anthropicClient().messages.create({
    model: ONBOARDING_MODEL,
    max_tokens: ENGINE_MAX_TOKENS,
    system: buildEngineSystemPrompt({ currentIntent, nextIntent, extracted }),
    tools: [buildEngineTool(currentIntent)],
    tool_choice: { type: "tool", name: ENGINE_TOOL_NAME },
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  if (response.stop_reason === "max_tokens") {
    console.warn("runEngineTurn: response truncated at max_tokens — question/extracted_updates may be lost", {
      outputTokens: response.usage.output_tokens,
    });
  }

  let question = "";
  let extractedUpdates: Record<string, unknown> = {};
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === ENGINE_TOOL_NAME) {
      const input = block.input as { question?: unknown; extracted_updates?: unknown };
      if (typeof input.question === "string") question = input.question;
      if (input.extracted_updates && typeof input.extracted_updates === "object") {
        extractedUpdates = input.extracted_updates as Record<string, unknown>;
      }
    }
  }

  return {
    question: question.trim(),
    extractedUpdates,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    maxTokens: ENGINE_MAX_TOKENS,
  };
}

/**
 * ONB-A §2 stage 2: the "Show your range" card's four prompts are content-
 * generated (tailored to the anchor) but structurally fixed to these four
 * probes. Ships the exact copy from the owner's shipped framing (§2) as a
 * static constant rather than model output — only the four prompt bodies
 * below are generated. Out of INT2 scope: this is a separate, self-
 * contained one-shot call before the checklist engine's turns ever begin.
 */
export const CALIBRATION_INTRO_COPY =
  "Four short prompts about the work itself. Not a test — no scores, no wrong answers. " +
  "This is how your feed learns what you can actually do, beyond what your title says.";

export const CALIBRATION_GENERATION_SYSTEM_PROMPT = `You write exactly four short, open-ended prompts for the \
"Show your range" step of a job-search profile interview — never call this step a test or an assessment \
in anything you write; there are no scores and no wrong answers.

TONE RULES (hard constraint): direct, second person, no exclamation marks. Never use these words or \
phrases: "passion", "dream", "journey", "fulfilling", "lights you up", "calling", "purpose". Each \
prompt must be answerable in 2-5 sentences — no options, no rubric, nothing that reads as being graded.

You are given the anchor: either a current/most recent job title + company (+ optional tenure), or a \
free-text description of the person's situation when they have no clean title to anchor on (a student, \
someone between roles, a career-switcher). If given free text instead of a title, calibrate at a \
junior level anchored on whatever internships, coursework, or interests it mentions — do not invent a \
title or seniority level that the free text doesn't support.

Write exactly these four prompts, each grounded in the specific anchor you were given (never generic \
filler, never referencing a role that isn't theirs), in this order:
1. DEPTH PROBE — a concrete scenario from the core of the anchored role or situation: "A {a \
role-typical situation}. Walk me through how you'd handle it — a few sentences." Admits both junior \
and senior answers; level is inferred from the answer, never asked directly.
2. BREADTH PROBE — surfaces adjacent skills the title/situation alone hides: which parts of the work \
*around* their core focus do they get pulled into.
3. RANGE/REALIGNMENT PROBE — if their next step were outside their current lane, what would they want \
it to be, and what carries over. "Nothing, more of the same" is a valid, useful answer.
4. EVIDENCE PROBE — one piece of work they'd actually show someone: what it was, what they did, what \
happened.
Additionally: don't solicit confidential employer specifics in how you phrase any prompt — describe \
the shape, not the secrets.

Call record_calibration_prompts with exactly four prompt strings, in this order (depth, breadth, \
range, evidence). Do not include any other text in your reply — the prompts are rendered directly as \
a card list, not read as chat.`;

export const CALIBRATION_GENERATION_TOOLS: Anthropic.Tool[] = [
  {
    name: "record_calibration_prompts",
    description: "Record the four generated calibration prompts, in order: depth, breadth, range, evidence.",
    input_schema: {
      type: "object",
      properties: {
        prompts: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
      },
      required: ["prompts"],
    },
  },
];

// Cap audit (2026-07-19): was 1024, raised alongside the (now-retired)
// INTERVIEW_MAX_TOKENS.
export const CALIBRATION_GENERATION_MAX_TOKENS = 2048;

export interface CalibrationGenerationResult {
  prompts: string[];
  usage: { inputTokens: number; outputTokens: number };
  maxTokens?: number;
}

function anchorContextLine(anchor: AnchorStageData): string {
  if (anchor.current_title && anchor.current_company) {
    return `Anchor: ${anchor.current_title} at ${anchor.current_company}${
      anchor.years_in_role ? ` (${anchor.years_in_role})` : ""
    }.`;
  }
  return `Anchor (free text, no clean title): ${anchor.free_text ?? "unspecified"}`;
}

export async function runCalibrationGeneration(anchor: AnchorStageData): Promise<CalibrationGenerationResult> {
  const response = await anthropicClient().messages.create({
    model: ONBOARDING_MODEL,
    max_tokens: CALIBRATION_GENERATION_MAX_TOKENS,
    system: CALIBRATION_GENERATION_SYSTEM_PROMPT,
    tools: CALIBRATION_GENERATION_TOOLS,
    messages: [{ role: "user", content: anchorContextLine(anchor) }],
  });

  let prompts: string[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "record_calibration_prompts") {
      const input = block.input as { prompts?: unknown };
      if (Array.isArray(input.prompts)) prompts = input.prompts as string[];
    }
  }

  return {
    prompts,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    maxTokens: CALIBRATION_GENERATION_MAX_TOKENS,
  };
}

/**
 * Backs `web/lib/profile/regenerateCv.ts` (ONB-A decision #3): a focused
 * extraction call, separate from the main interview, for re-extracting a
 * resume uploaded after onboarding. Out of INT2 scope — unrelated to the
 * checklist engine's turn loop.
 */
export const RESUME_EXTRACTION_SYSTEM_PROMPT = `Extract a clean master CV and background summary from a pasted \
resume, for a job-search targeting profile (not a job application). Read the resume text, extract roles, \
dates, titles, employers, skills, education, and every metric mentioned. Call record_resume_extraction with a \
clean markdown "cv.md" body (one section per role plus skills/education) and a 2-4 sentence \
background_summary written the way they'd describe themselves to a peer. Do not include any other text in \
your reply.`;

export const RESUME_EXTRACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: "record_resume_extraction",
    description: "Record the extracted cv.md body and background_summary from a resume.",
    input_schema: {
      type: "object",
      properties: {
        cv_markdown: { type: "string" },
        background_summary: { type: "string" },
      },
      required: ["cv_markdown"],
    },
  },
];

export interface ResumeExtractionTurnResult {
  cv_markdown: string;
  background_summary?: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runResumeExtractionTurn(resumeText: string): Promise<ResumeExtractionTurnResult> {
  const response = await anthropicClient().messages.create({
    model: ONBOARDING_MODEL,
    max_tokens: 8192, // was 2048 — cv_markdown for a long resume alone can exceed it (cap audit 2026-07-19)
    system: RESUME_EXTRACTION_SYSTEM_PROMPT,
    tools: RESUME_EXTRACTION_TOOLS,
    messages: [{ role: "user", content: resumeText }],
  });

  let cv_markdown = "";
  let background_summary: string | undefined;
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "record_resume_extraction") {
      const input = block.input as { cv_markdown?: unknown; background_summary?: unknown };
      if (typeof input.cv_markdown === "string") cv_markdown = input.cv_markdown;
      if (typeof input.background_summary === "string") background_summary = input.background_summary;
    }
  }

  return {
    cv_markdown,
    background_summary,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
