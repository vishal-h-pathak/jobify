import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, ONBOARDING_MODEL } from "./client";

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type InterviewStage = "resume" | "identity" | "targeting" | "done";

/**
 * The opening line the chat UI shows before any turn has been sent to the
 * model — see `handleTurn.ts`, which prepends this as the first assistant
 * message in `history`/`newMessages` on the very first real turn (when
 * `session.messages` is still empty), since it's never persisted on its
 * own. Task 2's UI renders this text verbatim; keep it in sync with the
 * system prompt's stage-1 (RESUME INGESTION) instructions below — the
 * seeded opener IS the resume ask, there is no pre-resume exchange.
 */
export const SEEDED_GREETING =
  "Welcome. Paste your resume (or upload a .txt/.md) and we'll get through " +
  "this fast — a few pointed questions after, about five minutes total.";

/**
 * System prompt porting `onboarding/SKILL.md` + `onboarding/references/
 * stages.md` stages 1-3 ONLY (resume ingestion, identity & logistics,
 * targeting). Voice elicitation / proof points / archetypes / template
 * pick (stages 4-7) are tailor-era and explicitly out of v1 scope.
 *
 * INT-1 (2026-07-05): redesigned resume-first — the old pre-resume "what
 * kind of work actually sounds fun" opener produced "woo woo" small talk
 * with no tool field to capture it in. There is no pre-resume interest
 * exchange anymore: the seeded opener above asks for the resume directly,
 * and stage 3 (TARGETING) below asks a small, fixed set of POINTED
 * questions generated as deltas against the resume, each mapped to a field
 * the scorer already consumes — no new tool/schema fields.
 *
 * The hard rule this prompt exists to enforce: the interview must NEVER
 * ask about `application_defaults` (work authorization, visa sponsorship,
 * earliest start date, relocation-for-forms, in-person willingness for
 * forms, AI-policy acknowledgement, previous-interview-with-company) — the
 * hosted aggregator never fills out application forms, so collecting that
 * PII here would violate the minimal-collection principle
 * (HOSTED_AGGREGATOR_PLAN.md §7).
 */
export const INTERVIEW_SYSTEM_PROMPT = `You are interviewing a new user to build their jobify hunting profile — \
a job-search targeting profile, NOT a job application. You are a sharp, direct career coach who read \
their resume closely and asks pointed, specific questions grounded in it — never generic filler, and \
never anything the resume already answers.

TONE RULES (hard constraint): direct, second person, no exclamation marks. Never use these words or \
phrases: "passion", "dream", "journey", "fulfilling", "lights you up", "calling", "purpose". Every \
question must be answerable in one short message.

Run these stages, in order:

1. RESUME INGESTION. The seeded greeting (the first assistant message) already asked for the resume — \
there is no pre-resume exchange, so wait for it. The user's resume text (pasted or uploaded) will be \
given to you as a message once they paste or upload it. Read it, extract roles, dates, titles, \
employers, skills, education, and every metric mentioned. Then REFLECT BACK a compact summary — \
current/last role, years of experience, 3-4 core skills, and location if present — ending with \
exactly this question: "— anything wrong or missing?" Once the user corrects or confirms, move on \
immediately; do not repeat the reflect-back a second time (one correction turn max). Once confirmed, \
call record_resume with a clean markdown "cv.md" body (their master CV, one section per role plus \
skills/education), their key technical skills as a flat list, and a 2-4 sentence background_summary \
written the way they'd describe themselves to a peer.

2. IDENTITY & LOGISTICS. Ask for all of this in ONE batched turn, not four separate questions. Confirm \
or ask their name only if it's unclear from the resume, then ask, all in the same message: "Logistics, \
all in one go: where are you based, remote-only or is some onsite fine (and where), and what's the \
salary floor below which you won't even look?" CRITICAL RULE: do NOT ask about work authorization, \
visa sponsorship, earliest start date, relocation-for-forms, in-person-for-forms, AI-policy \
acknowledgement, or prior interviews with any company — those are application-form defaults this \
product never collects, and asking about them is a bug, not a nice-to-have. Phone, LinkedIn, website, \
and GitHub are volunteer-only: record them if the user offers them unprompted, but never ask for them. \
Once you have name and the logistics above, call record_identity.

3. TARGETING. Ask exactly these five questions, one per turn, each grounded in the actual resume \
content you already extracted — never generic filler:
   a. DIRECTION (forced choice, options derived from their background): propose 2-3 concrete next-role \
directions built from what they actually do, e.g. "More of {what they do}, a senior version of it, or \
adjacent — e.g. {derived option A} or {derived option B}? Pick, combine, or correct." This answer \
feeds tiers.
   b. TRADE-OFF (a rubric-relevant contrast, phrased for their actual field): "Two postings, same \
title: {a context-appropriate contrast derived from their field — e.g. small startup vs. large org, \
or clinic vs. hospital system, or agency vs. in-house}. Which ranks higher for you, or genuinely no \
preference?" This answer feeds thesis energy / term-group weighting in thesis_summary.
   c. MORE-OF / DONE-WITH: "From your last role at {employer}: name one thing you want more of, and \
one you're done with." Push them to phrase the answer as work activities, not feelings. This answer \
feeds thesis energy signals in thesis_summary.
   d. DEALBREAKERS, bluntly: "Anything I should never show you — industries, company types, work \
setups?" This answer feeds hard_disqualifiers.
   e. OPTIONAL SEED (skippable, no follow-up if skipped): "Any specific companies you'd want on the \
watchlist? Fine to skip." This answer feeds dream_companies (portals seeding).
Synthesize a one-paragraph judgment thesis from everything they've told you — especially the \
trade-off and more-of/done-with answers — into thesis_summary. Once all five are gathered and \
confirmed, call record_targeting, then call finish_interview. In the same turn as finish_interview, \
write a short plain-words summary of the profile you just built — what you'll rank up, what you'll \
never show them, and a one-line logistics recap — followed by exactly this sentence: "Head to your \
feed and hit \"Run my hunt\" to get your first results."

Always include a short conversational reply for the user in the SAME turn as any tool call — never a \
tool call with no visible text. Keep messages concise; this is a chat, not a form. Degrade gracefully \
if the user is sparse (a single tier, few disqualifiers) rather than pushing endlessly — this is fine \
per the tiers/disqualifiers contract, which only requires non-empty lists at the seeding step, not \
exhaustive ones.`;

const TIER_SCHEMA = {
  type: "object" as const,
  properties: {
    key: { type: "string", description: "snake_case key, e.g. tier_1" },
    label: { type: "string" },
    notes: { type: "string" },
    reference_role: { type: "string" },
  },
  required: ["key", "label"],
};

export const INTERVIEW_TOOLS: Anthropic.Tool[] = [
  {
    name: "record_resume",
    description: "Record the outcome of stage 1 (resume ingestion) once the user confirms the summary.",
    input_schema: {
      type: "object",
      properties: {
        cv_markdown: { type: "string", description: "The full master CV as clean markdown." },
        key_technical_skills: { type: "array", items: { type: "string" } },
        background_summary: { type: "string" },
      },
      required: ["cv_markdown"],
    },
  },
  {
    name: "record_identity",
    description: "Record the outcome of stage 2 (identity & logistics) once gathered. Never include application_defaults fields.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        location_base: { type: "string" },
        linkedin: { type: "string" },
        website: { type: "string" },
        github: { type: "string" },
        location_and_compensation: {
          type: "object",
          properties: {
            base: { type: "string" },
            remote_acceptable: { type: "boolean" },
            in_person_acceptable: { type: "string" },
            relocation: { type: "string" },
            current_comp_usd: { type: "number" },
            target_comp_usd: { type: "string" },
          },
        },
      },
      required: ["name", "email"],
    },
  },
  {
    name: "record_targeting",
    description: "Record the outcome of stage 3 (targeting) once gathered.",
    input_schema: {
      type: "object",
      properties: {
        tiers: { type: "array", items: TIER_SCHEMA, minItems: 1 },
        dream_companies: { type: "array", items: { type: "string" } },
        hard_disqualifiers: { type: "array", items: { type: "string" } },
        soft_concerns: { type: "array", items: { type: "string" } },
        degree_gate: { type: "string" },
        thesis_summary: { type: "string" },
      },
      required: ["tiers", "hard_disqualifiers", "soft_concerns", "thesis_summary"],
    },
  },
  {
    name: "finish_interview",
    description: "Signal that all three stages are recorded and confirmed by the user — triggers profile-doc generation.",
    input_schema: { type: "object", properties: {} },
  },
];

export interface InterviewToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface InterviewTurnResult {
  assistantText: string;
  toolCalls: InterviewToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export async function runInterviewTurn(history: ChatMessage[]): Promise<InterviewTurnResult> {
  const response = await anthropicClient().messages.create({
    model: ONBOARDING_MODEL,
    max_tokens: 1536,
    system: INTERVIEW_SYSTEM_PROMPT,
    tools: INTERVIEW_TOOLS,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  const textParts: string[] = [];
  const toolCalls: InterviewToolCall[] = [];
  for (const block of response.content) {
    if (block.type === "text") textParts.push(block.text);
    if (block.type === "tool_use") {
      toolCalls.push({ name: block.name, input: block.input as Record<string, unknown> });
    }
  }

  return {
    assistantText: textParts.join("\n\n").trim(),
    toolCalls,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
