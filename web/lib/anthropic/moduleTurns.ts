import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, ONBOARDING_MODEL } from "./client";

/**
 * V3A-B2 §2: LLM turns for the three phase-2/3 modules — voice, metrics,
 * mirror. Same shape as `runInterviewTurn` / `runCalibrationGeneration` /
 * `runResumeExtractionTurn` in `./interview.ts`: one `anthropicClient()`
 * call with a forced tool, extraction from `response.content`, usage
 * passed through. Each of these runs on a dedicated module route (never
 * the `/turn` chat path — see `V3A_DESIGN.md` §2), so none of these
 * prompts produce a chat-style question; `handleTurn`'s ends-with-a-
 * question post-check never sees them.
 *
 * Verbatim filtering (`../onboarding/verbatim.ts`) against the user's raw
 * text is deliberately NOT done in this file — these functions are pure
 * LLM-turn wrappers, and only the route (task 5) has the raw source text
 * (`sample`, `searchableText`, the user's free-text answers) in scope to
 * filter against.
 */

// ---------------------------------------------------------------------------
// 1. Voice ingest
// ---------------------------------------------------------------------------

export const VOICE_INGEST_SYSTEM_PROMPT = `You are analyzing a writing sample from a candidate building a job-search \
targeting profile — NOT a job application, and NOT a writing assessment. The sample is either something the \
candidate pasted (an email, a doc excerpt, a post) or wrote fresh in response to "explain what you actually do to a \
friend." Your only job is to describe how the candidate sounds on the page, so their tailored materials can be \
written in a voice that is recognizably theirs.

HARD RULE — DESCRIPTIVE, NEVER EVALUATIVE: characterize the sample, never grade it. Say "plainspoken, short \
sentences," never "good writer" or "clear communicator." Say "leans on short declarative clauses," never "strong \
writing" or "needs work." There is no quality axis here — only a description of the shape of the prose.

HARD RULE — NO PERSONALITY INFERENCE: you are describing sentence-level texture (word choice, rhythm, register), \
never inferring who the candidate is as a person. Do not label them "confident," "analytical," "creative," or any \
other trait — that is outside what a writing sample can support and outside this tool's job.

HARD RULE — NO GRADING: never mention correctness, polish, typos, grammar, or how the sample compares to any \
standard. Typos and rough edges in the sample are irrelevant to what you're recording — you are listening for \
sound, not proofreading.

Call record_voice with exactly these five fields, all required:
- register: the overall tone/formality of the sample (e.g. "dry, compressed" or "warm, conversational").
- rhythm: the sentence-level cadence (e.g. "short declarative sentences, few subordinate clauses").
- words_used: specific words or word-choices actually present in the sample that are distinctive of how the \
candidate writes.
- words_avoided: specific words or phrasings the sample conspicuously avoids given its subject matter (e.g. no \
jargon, no hedging qualifiers, no filler).
- signature_phrases: short phrases lifted directly from the sample that are distinctive of the candidate's voice — \
these must be exact wording drawn from the sample, not paraphrases or inventions (they are verified against the \
original sample downstream; anything you paraphrase instead of quoting will be dropped).

Do not include any other text in your reply — record_voice is the entire output.`;

export const VOICE_INGEST_TOOLS: Anthropic.Tool[] = [
  {
    name: "record_voice",
    description: "Record the descriptive voice-profile analysis of a candidate's writing sample.",
    input_schema: {
      type: "object",
      properties: {
        register: { type: "string" },
        rhythm: { type: "string" },
        words_used: { type: "array", items: { type: "string" } },
        words_avoided: { type: "array", items: { type: "string" } },
        signature_phrases: { type: "array", items: { type: "string" } },
      },
      required: ["register", "rhythm", "words_used", "words_avoided", "signature_phrases"],
    },
  },
];

export interface VoiceTurnResult {
  register: string;
  rhythm: string;
  words_used: string[];
  words_avoided: string[];
  signature_phrases: string[];
  usage: { inputTokens: number; outputTokens: number };
}

export async function runVoiceIngestTurn(sample: string): Promise<VoiceTurnResult> {
  const response = await anthropicClient().messages.create({
    model: ONBOARDING_MODEL,
    max_tokens: 1024,
    system: VOICE_INGEST_SYSTEM_PROMPT,
    tools: VOICE_INGEST_TOOLS,
    messages: [{ role: "user", content: sample }],
  });

  let register = "";
  let rhythm = "";
  let words_used: string[] = [];
  let words_avoided: string[] = [];
  let signature_phrases: string[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "record_voice") {
      const input = block.input as {
        register?: unknown;
        rhythm?: unknown;
        words_used?: unknown;
        words_avoided?: unknown;
        signature_phrases?: unknown;
      };
      if (typeof input.register === "string") register = input.register;
      if (typeof input.rhythm === "string") rhythm = input.rhythm;
      if (Array.isArray(input.words_used)) words_used = input.words_used as string[];
      if (Array.isArray(input.words_avoided)) words_avoided = input.words_avoided as string[];
      if (Array.isArray(input.signature_phrases)) signature_phrases = input.signature_phrases as string[];
    }
  }

  return {
    register,
    rhythm,
    words_used,
    words_avoided,
    signature_phrases,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

// ---------------------------------------------------------------------------
// 2. Metrics extraction
// ---------------------------------------------------------------------------

export const METRICS_EXTRACTION_SYSTEM_PROMPT = `You are sweeping everything known about a candidate — their CV, \
extracted profile fields, and their own chat messages from a job-search targeting interview — for quantifiable, \
outcome-shaped claims a candidate might want to use in a resume or cover letter. This is a job-search targeting \
profile, NOT a job application, and you are not writing anything yet — only finding candidate claims for the \
candidate to later confirm or reject.

HARD RULE — VERBATIM ONLY: every claim's text must be copied directly from the supplied text, not paraphrased, not \
summarized, not combined from multiple places. If you cannot find a claim written essentially as-is somewhere in \
the input, do not record it — it is verified as a substring of the input downstream, and anything you paraphrase \
instead of quoting will be dropped.

HARD RULE — NEVER INVENT: never infer a metric, estimate a number, or round up. Only claims that are actually \
present in the text count. If the candidate did not write it, it does not exist for this tool.

HARD RULE — ONLY QUANTIFIABLE / OUTCOME CLAIMS: record only claims that describe a measurable outcome or a number \
— counts, percentages, dollar amounts, durations, scale, or a concrete before/after result. Skip vague claims of \
impact with no measurable content ("helped the team a lot" is not a claim; "cut deploy time from 40 minutes to 6" \
is).

Record at most 12 claims — the strongest, clearest ones if there are more candidates than that. For each claim, \
call record_metric_claims with:
- id: a short stable string you assign, e.g. "claim_1", "claim_2".
- text: the verbatim claim text, copied from the input.
- source: exactly one of "cv", "range", "energy", or "anchor" — whichever part of the supplied input the claim \
came from.
- has_number: true if the claim text contains an actual number or percentage, false if it is a countable/scale \
outcome without a literal digit (e.g. "shipped the migration to production" with no number in the sentence itself).

Do not include any other text in your reply — record_metric_claims is the entire output.`;

const METRIC_CLAIM_SCHEMA = {
  type: "object" as const,
  properties: {
    id: { type: "string" },
    text: { type: "string" },
    source: { type: "string", enum: ["cv", "range", "energy", "anchor"] },
    has_number: { type: "boolean" },
  },
  required: ["id", "text", "source", "has_number"],
};

export const METRICS_EXTRACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: "record_metric_claims",
    description: "Record the quantifiable/outcome claims found verbatim in the supplied candidate text.",
    input_schema: {
      type: "object",
      properties: {
        claims: { type: "array", items: METRIC_CLAIM_SCHEMA, maxItems: 12 },
      },
      required: ["claims"],
    },
  },
];

export type MetricClaimSource = "cv" | "range" | "energy" | "anchor";

export interface MetricClaim {
  id: string;
  text: string;
  source: MetricClaimSource;
  has_number: boolean;
}

export interface MetricsExtractionResult {
  claims: MetricClaim[];
  usage: { inputTokens: number; outputTokens: number };
}

const METRIC_SOURCES: readonly MetricClaimSource[] = ["cv", "range", "energy", "anchor"];

function isMetricClaim(value: unknown): value is MetricClaim {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.text === "string" &&
    typeof v.source === "string" &&
    METRIC_SOURCES.includes(v.source as MetricClaimSource) &&
    typeof v.has_number === "boolean"
  );
}

export async function runMetricsExtractionTurn(searchableText: string): Promise<MetricsExtractionResult> {
  const response = await anthropicClient().messages.create({
    model: ONBOARDING_MODEL,
    max_tokens: 2048,
    system: METRICS_EXTRACTION_SYSTEM_PROMPT,
    tools: METRICS_EXTRACTION_TOOLS,
    messages: [{ role: "user", content: searchableText }],
  });

  let claims: MetricClaim[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "record_metric_claims") {
      const input = block.input as { claims?: unknown };
      if (Array.isArray(input.claims)) {
        claims = input.claims.filter(isMetricClaim).slice(0, 12);
      }
    }
  }

  return {
    claims,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

// ---------------------------------------------------------------------------
// 3. Mirror generation
// ---------------------------------------------------------------------------

export const MIRROR_GENERATION_SYSTEM_PROMPT = `You are writing the mirror moment of a candidate's job-search \
targeting profile — the moment they read back a short reflection of everything they've told you and recognize \
themselves in it. This is NOT a job application and NOT a personality assessment. You are given a readable summary \
of everything gathered about the candidate so far (their anchor, values, energy signals, range, evidence, and \
whatever else has been extracted) plus the current state of their profile document. Write from that, and only from \
that.

HARD RULE — LENGTH AND FORM: write exactly two paragraphs, second person ("you"), 180 words total across both \
paragraphs or fewer. No headings, no bullet points, no lists — prose only.

HARD RULE — AT LEAST TWO VERBATIM QUOTES: weave in at least two short phrases the candidate actually wrote, word \
for word, somewhere in the two paragraphs — not paraphrased, not cleaned up, not summarized. List every phrase you \
quoted, exactly as it appears in the two paragraphs, in quoted_phrases. Phrases you paraphrase instead of quoting \
verbatim are useless here: they are verified as substrings of the candidate's own free-text answers downstream, \
and anything that isn't an exact quote is dropped, which can cause the whole reflection to be regenerated. Quote \
precisely.

HARD RULE — NEVER DIAGNOSE OR LABEL: do not assign a personality type, archetype, or trait noun of any kind. \
Specifically banned, with no exceptions: any named personality-type framework or system, "perfectionist", \
"type-A", "introvert", "extrovert", or any other trait noun that is not directly evidenced by specific things the \
candidate said. If you find yourself reaching for a label, describe the concrete behavior or pattern instead — \
what they actually do, not what kind of person that makes them.

HARD RULE — NEVER STATE A FACT ABSENT FROM THE INPUTS: everything you write must be traceable to something in the \
summary you were given. Never invent a detail, a number, a company, or an outcome that isn't already there.

HARD RULE — TONE: no exclamation marks anywhere, and no question marks anywhere — not as rhetorical devices, not \
mid-paragraph, not at the end. Every sentence in both paragraphs is a statement; end the second paragraph \
declaratively too. This text is never shown to the model again for a follow-up turn, so there is nothing to ask; \
asking a question here, anywhere in either paragraph, is always wrong.

Call record_mirror with exactly two fields:
- paragraphs: an array of exactly two strings, the two paragraphs in order.
- quoted_phrases: the verbatim phrases you wove in, exactly as they appear in the paragraphs above (at least two).

Do not include any other text in your reply — record_mirror is the entire output.`;

export const MIRROR_GENERATION_TOOLS: Anthropic.Tool[] = [
  {
    name: "record_mirror",
    description: "Record the two-paragraph mirror reflection and the verbatim phrases quoted within it.",
    input_schema: {
      type: "object",
      properties: {
        paragraphs: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
        quoted_phrases: { type: "array", items: { type: "string" } },
      },
      required: ["paragraphs", "quoted_phrases"],
    },
  },
];

export interface MirrorGenerationInput {
  extractedSummary: string;
}

export interface MirrorGenerationResult {
  paragraphs: [string, string];
  quoted_phrases: string[];
  usage: { inputTokens: number; outputTokens: number };
}

function isTwoStringTuple(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string");
}

export async function runMirrorGenerationTurn(inputs: MirrorGenerationInput): Promise<MirrorGenerationResult> {
  const response = await anthropicClient().messages.create({
    model: ONBOARDING_MODEL,
    max_tokens: 1024,
    system: MIRROR_GENERATION_SYSTEM_PROMPT,
    tools: MIRROR_GENERATION_TOOLS,
    messages: [{ role: "user", content: inputs.extractedSummary }],
  });

  let paragraphs: [string, string] = ["", ""];
  let quoted_phrases: string[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "record_mirror") {
      const input = block.input as { paragraphs?: unknown; quoted_phrases?: unknown };
      if (isTwoStringTuple(input.paragraphs)) paragraphs = input.paragraphs;
      if (Array.isArray(input.quoted_phrases)) quoted_phrases = input.quoted_phrases as string[];
    }
  }

  return {
    paragraphs,
    quoted_phrases,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
