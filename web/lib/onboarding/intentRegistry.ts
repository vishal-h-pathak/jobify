import type { ExtractedState } from "../profile/buildDoc";
import type { IntentKey } from "./checklist";
import { missingFieldsForIntent } from "./checklist";

/**
 * INT2 engine contract points 2-4: groups the checklist's fields into the
 * four things a single `interview_turn` tool call can be asked to do this
 * turn. Each `IntentSpec` supplies (a) the JSON-schema fragment for its
 * slice of the forced tool's `extracted_updates`, (b) prompt guidance for
 * when it's the CURRENT (extraction) target vs. the NEXT (question)
 * target, and (c) a deterministic, context-derived fallback question —
 * never a global canned string — for the retry-exhausted and
 * no-progress-loop-breaker paths (point 4).
 */
export interface IntentSpec {
  key: IntentKey;
  schema: Record<string, unknown>;
  /** Folded into the system prompt when this intent is the CURRENT (extraction) target. */
  extractionGuidance: string;
  /** Folded into the system prompt when this intent is the NEXT (question) target. */
  askGuidance: (extracted: ExtractedState) => string;
  /** Rendered verbatim as `assistantText` when the model's own phrasing
   *  can't be trusted this turn. `attempt` (1-indexed, defaults to 1)
   *  selects a distinct phrasing variant on repeat renders for the same
   *  stuck intent (Fix B, session 57) — NO-REPEAT must never see the exact
   *  same template text twice. */
  renderFallbackQuestion: (extracted: ExtractedState, attempt: number) => string;
}

const TIER_SCHEMA = {
  type: "object",
  properties: {
    key: { type: "string", description: "snake_case key, e.g. tier_1" },
    label: { type: "string" },
    notes: { type: "string" },
    reference_role: { type: "string" },
  },
  required: ["key", "label"],
} as const;

const LOCATION_AND_COMPENSATION_SCHEMA = {
  type: "object",
  properties: {
    base: { type: "string" },
    remote_acceptable: { type: "boolean" },
    in_person_acceptable: { type: "string" },
    relocation: { type: "string" },
    current_comp_usd: { type: "number" },
    target_comp_usd: { type: "string" },
  },
} as const;

/**
 * Cycles through a fixed variant list by attempt number (1-indexed) rather
 * than collapsing every attempt >= 2 onto a single string — a 2-variant
 * collapse still repeats verbatim on the 3rd+ render, which is exactly
 * what the corrective persona's stuck-on-name case caught (turn 8 replayed
 * turn 6's exact override text). Each list here has 6 entries, guaranteeing
 * no repeat across up to 6 consecutive fires on the same intent — beyond
 * that the rotation wraps and CAN repeat. That bound is deliberate, not an
 * oversight: PROGRESS already fails a session that's stuck 6+ times on one
 * intent (budget is 4 turns), so a genuinely pathological streak long
 * enough to exhaust 6 variants is already a failing run for an unrelated,
 * structural reason (see session 57's report — no skip path exists for a
 * user who never answers a hard-required field).
 */
function pickVariant(attempt: number, variants: readonly string[]): string {
  return variants[(Math.max(1, attempt) - 1) % variants.length]!;
}

const RESUME_ASK_TEXT_VARIANTS = [
  "Have a resume handy? Paste/upload it — or skip, we already have plenty.",
  "Still fine to skip if you'd rather not dig one up — otherwise paste or upload your resume.",
  "No pressure either way: paste/upload a resume if you've got one handy, or say skip.",
  "Last check on this — resume to paste/upload, or skip and we'll move on with what we have.",
  "Happy to skip this if you'd rather — otherwise a pasted or uploaded resume works.",
  "Whenever you're ready: paste/upload a resume, or just say skip and we'll continue.",
] as const;

const LOGISTICS_FRAGMENT =
  "where you're based, remote-only or is some onsite fine (and where), and what's the salary floor below which you won't even look";

const LOGISTICS_AND_NAME_VARIANTS = [
  `Logistics, all in one go: ${LOGISTICS_FRAGMENT} — and what's your name?`,
  `Still need the basics: ${LOGISTICS_FRAGMENT} — and your name.`,
  `To wrap this up: ${LOGISTICS_FRAGMENT}, plus what to call you.`,
  `Just need this one batch: ${LOGISTICS_FRAGMENT} — and your name for the profile.`,
  `Two things left: ${LOGISTICS_FRAGMENT}, and a name for the profile.`,
  `Rounding this out: ${LOGISTICS_FRAGMENT} — and what you'd like to be called.`,
] as const;

const LOGISTICS_ONLY_VARIANTS = [
  `Logistics, all in one go: ${LOGISTICS_FRAGMENT}?`,
  `Just the logistics left: ${LOGISTICS_FRAGMENT}?`,
  `To finish up: ${LOGISTICS_FRAGMENT}?`,
  `One more batch: ${LOGISTICS_FRAGMENT}?`,
  `Still need this: ${LOGISTICS_FRAGMENT}?`,
  `Last piece: ${LOGISTICS_FRAGMENT}?`,
] as const;

const NAME_ONLY_VARIANTS = [
  "What's your name?",
  "What should I call you?",
  "Still need a name for the profile — what is it?",
  "Last thing: what should the profile say for your name?",
  "One more time: what's your name?",
  "Just the name left — what should I put down?",
] as const;

function identityAskText(extracted: ExtractedState, attempt: number): string {
  const missing = missingFieldsForIntent("identity", extracted).map((f) => f.key);
  const needsName = missing.includes("identity_name");
  const needsLogistics = missing.includes("identity_logistics");
  if (needsLogistics && needsName) return pickVariant(attempt, LOGISTICS_AND_NAME_VARIANTS);
  if (needsLogistics) return pickVariant(attempt, LOGISTICS_ONLY_VARIANTS);
  if (needsName) return pickVariant(attempt, NAME_ONLY_VARIANTS);
  return "Anything else about your logistics I should know?";
}

const TARGETING_VARIANTS_BASE = (lead: string) => [
  `${lead}, name 2-3 concrete directions you'd want your next role to take, and in a couple sentences, ` +
    "what you're optimizing for in this search — any dream companies worth watching are optional.",
  "One more time, briefly: name 2-3 directions you'd want your next role to take, and what you're " +
    "optimizing for in this search — dream companies still optional.",
  "Coming back to targeting: 2-3 concrete directions for your next role, and what you're optimizing " +
    "for overall — dream companies are still optional.",
  "Still need this to finish up: 2-3 next-role directions, and what you're optimizing for in this " +
    "search — dream companies optional.",
  "Circling back: name 2-3 directions for your next role, and what you're optimizing for — dream " +
    "companies still optional if any come to mind.",
  "Last piece needed: 2-3 directions for your next role, plus what you're optimizing for overall.",
];

function targetingAskText(extracted: ExtractedState, attempt: number): string {
  const title = extracted.anchor?.current_title;
  const lead = title ? `Based on your background as a ${title}` : "Based on what you've told me so far";
  return pickVariant(attempt, TARGETING_VARIANTS_BASE(lead));
}

export const INTENT_REGISTRY: Record<IntentKey, IntentSpec> = {
  calibration: {
    key: "calibration",
    schema: {
      type: "object",
      description: "The calibration ingest turn's synthesis of the four calibration answers.",
      properties: {
        skills: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
        range_statement: { type: "string" },
        background_summary: { type: "string" },
      },
      required: ["skills", "evidence", "range_statement", "background_summary"],
    },
    extractionGuidance:
      "The user's message answers the four calibration prompts already shown to them (a depth, breadth, " +
      "range/realignment, and evidence probe). NEVER evaluate, grade, praise, or compare their answers — you " +
      "are recording signal, not judging performance. Do not solicit confidential employer specifics: describe " +
      "the shape, not the secrets. Extract: a flat skills list across all four answers; one or two concrete " +
      "evidence bullets they'd actually show someone; the range/realignment answer close to verbatim as " +
      "range_statement; and a 2-4 sentence background_summary synthesizing all four, written the way they'd " +
      "describe themselves to a peer.",
    askGuidance: (extracted) => extracted.calibration?.prompts?.[0] ?? "their answers to the four calibration prompts",
    renderFallbackQuestion: (extracted, attempt) => {
      const base =
        extracted.calibration?.prompts?.[0] ??
        "Let's capture your range — tell me about the core of your work in a few sentences.";
      const prefixes = [
        "",
        "Coming back to this one: ",
        "Still want to hear this: ",
        "One more time on this one: ",
        "Circling back to this: ",
        "Last time on this one: ",
      ];
      return `${pickVariant(attempt, prefixes)}${base}`;
    },
  },
  resume: {
    key: "resume",
    schema: {
      type: "object",
      description: "The optional resume stage's outcome.",
      properties: {
        cv_markdown: { type: "string", description: "The full master CV as clean markdown, one section per role plus skills/education." },
        key_technical_skills: { type: "array", items: { type: "string" } },
        background_summary: { type: "string" },
        skipped: { type: "boolean", description: "Set true if the user says they don't have or don't want to share a resume." },
      },
    },
    extractionGuidance:
      "If the user pasted or uploaded resume text, read it and extract roles, dates, titles, employers, skills, " +
      "education, and every metric mentioned into a clean markdown cv_markdown body (one section per role plus " +
      "skills/education), key_technical_skills as a flat list, and a 2-4 sentence background_summary. If they " +
      "said they don't have one or want to skip it, set skipped:true and leave the rest empty — never invent CV content.",
    askGuidance: () => RESUME_ASK_TEXT_VARIANTS[0],
    renderFallbackQuestion: (_extracted, attempt) => pickVariant(attempt, RESUME_ASK_TEXT_VARIANTS),
  },
  identity: {
    key: "identity",
    schema: {
      type: "object",
      description: "Name and logistics gathered during the targeting stage's opener.",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        location_base: { type: "string" },
        linkedin: { type: "string" },
        website: { type: "string" },
        github: { type: "string" },
        location_and_compensation: LOCATION_AND_COMPENSATION_SCHEMA,
      },
      required: ["name"],
    },
    extractionGuidance:
      "CRITICAL RULE (hard constraint): never ask about or record work authorization, visa sponsorship, earliest " +
      "start date, relocation-for-forms, in-person-for-forms, AI-policy acknowledgement, or prior interviews with " +
      "any company — those are application-form defaults this product never collects. Phone, LinkedIn, website, " +
      "and GitHub are volunteer-only: record them if offered unprompted, never ask for them. Extract name and " +
      "logistics (base location, remote/onsite preference, salary floor) from the user's message into name / " +
      "location_and_compensation.",
    askGuidance: (extracted) => identityAskText(extracted, 1),
    renderFallbackQuestion: (extracted, attempt) => identityAskText(extracted, attempt),
  },
  targeting: {
    key: "targeting",
    schema: {
      type: "object",
      description: "The targeting stage's generated-question outcome.",
      properties: {
        tiers: { type: "array", items: TIER_SCHEMA, minItems: 1 },
        thesis_summary: { type: "string" },
        dream_companies: { type: "array", items: { type: "string" }, description: "Optional seed — skippable, no follow-up if skipped." },
        hard_disqualifiers: { type: "array", items: { type: "string" } },
        soft_concerns: { type: "array", items: { type: "string" } },
        degree_gate: { type: "string" },
      },
      required: ["tiers", "thesis_summary"],
    },
    extractionGuidance:
      "Dealbreakers are no longer asked here — the dealbreakers module owns that ground now; never ask about " +
      "them. Extract 2-3 concrete next-role tiers (key/label/notes/reference_role) built from the candidate's " +
      "actual background, and synthesize a one-paragraph judgment thesis into thesis_summary from everything " +
      "known so far. dream_companies is an optional seed for the watchlist — skippable, no follow-up if skipped.",
    askGuidance: (extracted) => targetingAskText(extracted, 1),
    renderFallbackQuestion: (extracted, attempt) => targetingAskText(extracted, attempt),
  },
};

const ANYTHING_ELSE_SCHEMA = {
  type: "object",
  description:
    "Opportunistic capture of any OTHER known field the user's message revealed, beyond this turn's target — " +
    'using the SAME nested shape as the top-level fields (e.g. {"identity": {"location_base": "Denver, CO"}}). ' +
    "Omit entirely if nothing else was learned.",
  properties: {
    calibration: INTENT_REGISTRY.calibration.schema,
    resume: INTENT_REGISTRY.resume.schema,
    identity: INTENT_REGISTRY.identity.schema,
    targeting: INTENT_REGISTRY.targeting.schema,
  },
  additionalProperties: false,
} as const;

/** The forced `interview_turn` tool's dynamic `extracted_updates` schema, scoped to this turn's current target. */
export function buildExtractedUpdatesSchema(currentIntent: IntentKey): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      [currentIntent]: INTENT_REGISTRY[currentIntent].schema,
      anything_else: ANYTHING_ELSE_SCHEMA,
    },
    required: [],
    additionalProperties: false,
  };
}

/** Engine contract point 4: rendered whenever the model's own phrasing
 *  can't be trusted this turn. `attempt` (default 1) selects a distinct
 *  phrasing variant on repeat renders (Fix B, session 57). */
export function renderFallbackQuestion(intent: IntentKey, extracted: ExtractedState, attempt = 1): string {
  return INTENT_REGISTRY[intent].renderFallbackQuestion(extracted, attempt);
}
