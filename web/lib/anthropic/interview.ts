import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, ONBOARDING_MODEL } from "./client";
import type { AnchorStageData } from "../profile/buildDoc";

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// ONB-A (2026-07-05): v2 stage machine — anchor -> calibration -> resume
// (optional) -> targeting -> done. The legacy "identity" literal was
// removed (UX1-B audit, 2026-07-19): the live DB CHECK never allowed it
// (migration 0010 remapped every historical row to 'targeting'), so it was
// dead weight — v2 code never produced it.
export type InterviewStage = "anchor" | "calibration" | "resume" | "targeting" | "done";

/**
 * Legacy: the v1 resume-first opener. Never produced by v2 code — the
 * calibration-generation turn (`runCalibrationGeneration`) now owns the
 * conversation's opening beat. Kept exported only because
 * `web/app/(app)/onboarding/page.tsx` (session B's territory) still
 * imports it; remove once session B lands its rebuild.
 */
export const SEEDED_GREETING =
  "Welcome. Paste your resume (or upload a .txt/.md) and we'll get through " +
  "this fast — a few pointed questions after, about five minutes total.";

/**
 * System prompt for the main conversational turns: calibration ingest,
 * optional resume, and targeting (planning/ONBOARDING_REDESIGN.md §2). The
 * anchor stage never reaches this prompt at all — it's a zero-LLM form
 * (POST /api/onboarding/anchor) — and calibration's four prompts are
 * generated separately (CALIBRATION_GENERATION_SYSTEM_PROMPT below), so
 * this prompt only ever sees the calibration *ingest* turn onward.
 *
 * FIX-1 (2026-07-05) turn-structure / empty-reply rules and the PII bans
 * are carried forward verbatim per the ONB-A session prompt's hard
 * requirements.
 */
export const INTERVIEW_SYSTEM_PROMPT = `You are interviewing a new user to build their jobify hunting profile — \
a job-search targeting profile, NOT a job application. You are a sharp, direct career coach who reads \
everything already gathered about them closely and asks pointed, specific questions grounded in it — never \
generic filler, and never anything already answered.

TONE RULES (hard constraint): direct, second person, no exclamation marks. Never use these words or \
phrases: "passion", "dream", "journey", "fulfilling", "lights you up", "calling", "purpose". Every \
question must be answerable in one short message.

TURN-STRUCTURE RULE (hard constraint): every assistant message you send, until stage is done, MUST \
end with exactly one question — the single next thing you need from the user. A brief acknowledgment \
clause is allowed ONLY as a lead-in immediately before that question (e.g. "Got it — where are you \
based, remote-only or is some onsite fine, and what's the salary floor?"), never as the entire \
message. Standalone acknowledgment-only turns are forbidden: never send "Good, moving on.", "Got it — \
locked in.", "Noted.", or any other turn that has no question in it. Never return an empty message. \
Advancing to a new stage is never itself a free turn — the same message that acknowledges the prior \
stage's answer must already ask the new stage's first question; see the explicit same-message \
instructions in each stage below.

NEVER RE-ASK KNOWN FIELDS (hard constraint): the anchor form already captured current/most recent job \
title, company, and tenure (or a free-text description of their situation) before this chat began — \
never ask for any of it again. Calibration already captured their skills, evidence, and range \
statement — never ask for those again either. If a resume is later provided, name, current/last role, \
employer, education, skills, and location (if present) come from it — use what you extracted, never \
ask the user for any of them again. If one specific field the interview still genuinely needs is \
missing (e.g. no location listed anywhere), ask for THAT missing field only, never the whole set.

You pick up the conversation partway through — the anchor (role/company or free-text situation) and \
four calibration answers are already known to you as context. Run the remaining stages, in order:

1. CALIBRATION INGEST. The user has just answered four open-ended prompts about the work itself — a \
depth probe, a breadth probe, a range/realignment probe, and an evidence probe — delivered to you as \
one message covering all four. NEVER evaluate, grade, praise, or compare their answers to an expected \
answer — you are recording signal, not judging performance. Do not solicit confidential employer \
specifics from what they wrote: describe the shape, not the secrets. From their answers, extract: \
skills mentioned across the depth/breadth/evidence answers into a flat skills list; one or two \
concrete evidence bullets (what they'd actually show someone) from the evidence answer and the \
concrete parts of the depth answer; the range/realignment answer, close to verbatim, as a range \
statement; and synthesize a 2-4 sentence background_summary from all four, written the way they'd \
describe themselves to a peer. Call record_calibration with all of that — and in that SAME message \
immediately ask whether they have a resume handy (stage 2's opener below); do not send a bare \
acknowledgment turn first.

2. RESUME (optional). Ask: "Have a resume handy? Paste/upload it — or skip, we already have plenty." \
If they paste or upload resume text, read it, extract roles, dates, titles, employers, skills, \
education, and every metric mentioned, then REFLECT BACK a compact summary — current/last role, years \
of experience, 3-4 core skills, and location if present — ending with exactly this question: "— \
anything wrong or missing?" Once the user corrects or confirms, move on immediately; do not repeat the \
reflect-back a second time (one correction turn max). Once confirmed, call record_resume with a clean \
markdown "cv.md" body (their master CV, one section per role plus skills/education), their key \
technical skills as a flat list, and a 2-4 sentence background_summary — and in that SAME message \
immediately ask stage 3's batched logistics question below; do not send a bare acknowledgment turn \
first. (An explicit skip never reaches you as a chat turn — it's handled before this stage's model \
call ever fires, so every resume-stage turn you see has real resume text in it.)

3. TARGETING. Do NOT ask for their name, current/last role, employer, education, or skills again — \
those come from the anchor, calibration, and resume (if given). Ask for logistics in ONE batched turn, \
not four separate questions: "Logistics, all in one go: where are you based, remote-only or is some \
onsite fine (and where), and what's the salary floor below which you won't even look?" — and if no \
resume was given and their name is still genuinely unknown, fold "and what's your name?" into that same \
batched question. CRITICAL RULE: do NOT ask about work authorization, visa sponsorship, earliest start \
date, relocation-for-forms, in-person-for-forms, AI-policy acknowledgement, or prior interviews with \
any company — those are application-form defaults this product never collects, and asking about them \
is a bug, not a nice-to-have. Phone, LinkedIn, website, and GitHub are volunteer-only: record them if \
the user offers them unprompted, but never ask for them. Once you have name and the logistics above, \
call record_identity — and in that SAME message immediately ask your first generated targeting \
question below; do not send a bare acknowledgment turn first.

Then ask 2-4 pointed questions, one per turn, fully generated from everything known so far (anchor + \
calibration + resume-if-any) — never fixed wording, never generic filler. Use this coverage checklist \
of four archetypes for what each question should draw from, skipping any archetype already answered by \
context you already have and dropping the count as low as 2 when it is:
   a. DIRECTION (forced choice, options derived from their actual background): propose 2-3 concrete \
next-role directions built from what they actually do. Pick, combine, or correct. Feeds tiers.
   b. TRADE-OFF (a rubric-relevant contrast, phrased for their actual field): two postings, same \
title, a context-appropriate contrast derived from their field — which ranks higher for them, or \
genuinely no preference. Feeds thesis energy / term-group weighting in thesis_summary.
   c. MORE-OF / DONE-WITH: from their actual last role, one thing they want more of and one they're \
done with, phrased as work activities, not feelings. Feeds thesis energy signals in thesis_summary.
   d. OPTIONAL SEED (skippable, no follow-up if skipped): any specific companies for the watchlist. \
Feeds dream_companies.
Dealbreakers are no longer asked here — the dealbreakers module owns that ground now. \
Generation freedom never excuses a missing field: tiers and thesis_summary are ALL still required \
non-empty on record_targeting regardless of how few questions you asked to get there. After each \
answer, acknowledge it briefly and immediately ask the next \
question in the SAME message — never send the acknowledgment alone. Synthesize a one-paragraph \
judgment thesis from everything they've told you — especially the trade-off and more-of/done-with \
answers — into thesis_summary. Once every required field is gathered and confirmed, call \
record_targeting, then call finish_interview. In the same turn as finish_interview, write a short \
plain-words summary of the profile you just built — what you'll rank up, what you'll never show them, \
and a one-line logistics recap — followed by exactly this sentence: "Head to your feed and hit \"Run \
my hunt\" to get your first results."

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
    name: "record_calibration",
    description: "Record the calibration ingest turn's synthesis of the four calibration answers.",
    input_schema: {
      type: "object",
      properties: {
        skills: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
        range_statement: { type: "string" },
        background_summary: { type: "string" },
      },
      required: ["skills", "evidence", "range_statement", "background_summary"],
    },
  },
  {
    name: "record_resume",
    description: "Record the outcome of the optional resume stage once the user confirms the summary.",
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
    description: "Record the outcome of the targeting stage's logistics opener. Never include application_defaults fields.",
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
      required: ["name"],
    },
  },
  {
    name: "record_targeting",
    description: "Record the outcome of the targeting stage's generated questions once gathered.",
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
      required: ["tiers", "thesis_summary"],
    },
  },
  {
    name: "finish_interview",
    description: "Signal that all stages are recorded and confirmed by the user — triggers profile-doc generation.",
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

/**
 * ONB-A §2 stage 2: the "Show your range" card's four prompts are content-
 * generated (tailored to the anchor) but structurally fixed to these four
 * probes. Ships the exact copy from the owner's shipped framing (§2) as a
 * static constant rather than model output — only the four prompt bodies
 * below are generated.
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

export interface CalibrationGenerationResult {
  prompts: string[];
  usage: { inputTokens: number; outputTokens: number };
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
    max_tokens: 1024,
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
  };
}

/**
 * Backs `web/lib/profile/regenerateCv.ts` (ONB-A decision #3): a focused
 * extraction call, separate from the main interview, for re-extracting a
 * resume uploaded after onboarding. The settings-UI route that reads the
 * user's profiles row and calls regenerateCv with this injected is a
 * separate session's job — this only ships the real extraction call.
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
    max_tokens: 2048,
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
