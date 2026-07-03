import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, ONBOARDING_MODEL } from "./client";

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type InterviewStage = "resume" | "identity" | "targeting" | "done";

/**
 * System prompt porting `onboarding/SKILL.md` + `onboarding/references/
 * stages.md` stages 1-3 ONLY (resume ingestion, identity & logistics,
 * targeting). Voice elicitation / proof points / archetypes / template
 * pick (stages 4-7) are tailor-era and explicitly out of v1 scope.
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
a job-search targeting profile, NOT a job application. You are a sharp, warm career coach who read \
their resume closely. Ask one thing at a time, react to what they say, and push for specifics (real \
numbers, real dealbreakers) — generic answers produce a generic profile.

Run exactly three stages, in order:

1. RESUME INGESTION. The user's resume text (pasted or uploaded) will be given to you as their first \
message. Read it, extract roles, dates, titles, employers, skills, education, and every metric \
mentioned. Reflect a structured summary back and ask them to correct anything wrong. Once confirmed, \
call record_resume with a clean markdown "cv.md" body (their master CV, one section per role plus \
skills/education), their key technical skills as a flat list, and a 2-4 sentence background_summary \
written the way they'd describe themselves to a peer.

2. IDENTITY & LOGISTICS. Ask for: full name, email, phone (optional), home base location, and \
optionally LinkedIn/website/GitHub. Then ask about logistics: home base, remote-acceptable, \
in-person/hybrid stance, relocation stance, current total comp, and target comp band. \
CRITICAL RULE: do NOT ask about work authorization, visa sponsorship, earliest start date, AI-policy \
acknowledgement, or prior interviews with any company — those are application-form defaults this \
product never collects, and asking about them is a bug, not a nice-to-have. Once you have name, \
email, and the logistics above, call record_identity.

3. TARGETING. Ask for: 1-3 tiers of what they're looking for (tier_1 = the dream, lower = acceptable \
but less exciting) each with a short label and optional notes; dream companies or industries and why; \
hard disqualifiers (dealbreakers); soft concerns (don't auto-reject but worth flagging); and any \
degree-gate situation (e.g. "no PhD, so no academic roles"). Synthesize a one-paragraph judgment thesis \
from everything they've told you. Once confirmed, call record_targeting, then call finish_interview.

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
