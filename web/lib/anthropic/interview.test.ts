import { describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
vi.mock("./client", () => ({
  anthropicClient: () => ({ messages: { create: createMock } }),
  ONBOARDING_MODEL: "claude-sonnet-5",
}));

const {
  CALIBRATION_GENERATION_SYSTEM_PROMPT,
  CALIBRATION_GENERATION_TOOLS,
  INTERVIEW_SYSTEM_PROMPT,
  INTERVIEW_TOOLS,
  RESUME_EXTRACTION_SYSTEM_PROMPT,
  RESUME_EXTRACTION_TOOLS,
  SEEDED_GREETING,
  runInterviewTurn,
  runCalibrationGeneration,
} = await import("./interview");

function usageResponse(content: unknown[], usage = { input_tokens: 111, output_tokens: 22 }) {
  return { content, usage };
}

// INTSIM reviewer addendum 2: TRUNCATION invariant — the sim needs to know
// each real call's max_tokens cap to tell "the model stopped naturally" from
// "the response was decapitated at the cap" (motivating live bug:
// record_targeting truncated at the (then-)1536 cap, indistinguishable
// downstream from an empty turn — since raised to 8192, cap audit
// 2026-07-19). Additive: exposes the same max_tokens value already passed
// to messages.create(), nothing else changes.
describe("runInterviewTurn — exposes maxTokens on the result", () => {
  it("returns maxTokens matching the cap passed to messages.create", async () => {
    createMock.mockResolvedValue(usageResponse([{ type: "text", text: "Got it — what's next?" }]));

    const result = await runInterviewTurn([{ role: "user", content: "hi" }]);

    expect(result.maxTokens).toBe(8192);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 8192 }));
  });
});

describe("runCalibrationGeneration — exposes maxTokens on the result", () => {
  it("returns maxTokens matching the cap passed to messages.create", async () => {
    createMock.mockResolvedValue(
      usageResponse([{ type: "tool_use", name: "record_calibration_prompts", input: { prompts: ["a", "b", "c", "d"] } }])
    );

    const result = await runCalibrationGeneration({ current_title: "Engineer", current_company: "Acme" });

    expect(result.maxTokens).toBe(2048);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 2048 }));
  });
});

describe("SEEDED_GREETING — kept only for pre-B onboarding UI compile compatibility", () => {
  it("is still a non-empty exported string (page.tsx imports it; v2 flow never produces it)", () => {
    expect(typeof SEEDED_GREETING).toBe("string");
    expect(SEEDED_GREETING.length).toBeGreaterThan(0);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — tone ban-list (unchanged, hard requirement)", () => {
  it("contains a literal ban-list of the forbidden words/phrases", () => {
    const lower = INTERVIEW_SYSTEM_PROMPT.toLowerCase();
    for (const word of ["passion", "dream", "journey", "fulfilling", "lights you up", "calling", "purpose"]) {
      expect(lower).toContain(word);
    }
  });

  it("bans exclamation marks and requires one-message-answerable questions", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/no exclamation marks/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — FIX-1: every non-terminal turn ends with a question (unchanged)", () => {
  it("contains a hard turn-structure rule requiring every turn to end with exactly one question", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/TURN-STRUCTURE RULE \(hard constraint\)/);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/must end with exactly one question/i);
  });

  it("forbids bare acknowledgment-only turns by name", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/standalone acknowledgment-only turns are forbidden/i);
  });

  it("bans empty messages explicitly", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/never return an empty message/i);
  });

  it("states advancing a stage is never itself a free turn", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/advancing to a new stage is never itself a free turn/i);
  });

  it("instructs record_calibration and record_resume to ask the next stage's question in the SAME message", () => {
    const sameMessageInstances = INTERVIEW_SYSTEM_PROMPT.match(/in that SAME message immediately ask/gi) ?? [];
    expect(sameMessageInstances.length).toBeGreaterThanOrEqual(2);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — ONB-A: never re-ask anchor/calibration/resume-known fields", () => {
  it("contains a hard rule extended to the anchor form and calibration", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/NEVER RE-ASK KNOWN FIELDS \(hard constraint\)/);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/anchor form already captured/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/calibration already captured/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — ONB-A: calibration ingest stage", () => {
  it("instructs the model to never evaluate, grade, or praise calibration answers", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/CALIBRATION INGEST/);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/NEVER evaluate, grade, praise/i);
  });

  it("carries the employer-confidentiality line", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/describe the shape, not the secrets/i);
  });

  it("maps calibration answers to skills / evidence / range_statement / background_summary", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/skills list/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/range statement/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/background_summary/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — ONB-A: resume is now optional", () => {
  it("asks the resume question and still bounds the reflect-back to one correction turn max", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("Have a resume handy? Paste/upload it — or skip, we already have plenty.");
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/one correction turn max/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("— anything wrong or missing?");
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — targeting stage: batched logistics + PII bans (unchanged)", () => {
  it("instructs ONE batched logistics turn with the verbatim rule", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain(
      "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
        "and what's the salary floor below which you won't even look?"
    );
  });

  it("still forbids work-authorization/sponsorship/start-date/AI-policy questions (CRITICAL RULE)", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("CRITICAL RULE");
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/work authorization/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/visa sponsorship/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/start date/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/AI-policy/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/prior interviews/i);
  });

  it("keeps phone/LinkedIn/website/GitHub volunteer-only", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/volunteer-only/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — ONB-A decision #4: fully-generated 2-4 targeting questions", () => {
  it("instructs 2-4 fully-generated questions, never fixed wording", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/2-4 pointed questions/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/never fixed wording/i);
  });

  it("keeps the four archetypes as a coverage checklist by name", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("DIRECTION");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("TRADE-OFF");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("MORE-OF / DONE-WITH");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("OPTIONAL SEED");
  });

  it("states generation freedom never excuses a missing required field", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/generation freedom never excuses a missing field/i);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/tiers and thesis_summary are ALL still required/i);
  });

  it("instructs skipping archetypes already answered by known context", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/skipping any archetype already answered/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — V3A-B2 §1.7: dealbreakers module owns filters now", () => {
  it("no longer asks about dealbreakers in the targeting archetype checklist", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).not.toMatch(/dealbreakers.{0,40}(bluntly|industries)/i);
    expect(INTERVIEW_SYSTEM_PROMPT).not.toContain("DEALBREAKERS");
  });

  it("explicitly states dealbreakers are no longer asked here", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/dealbreakers are no longer asked here/i);
  });
});

describe("INTERVIEW_SYSTEM_PROMPT — wrap-up (unchanged)", () => {
  it("instructs the wrap-up text to point the user at the feed's Run my hunt button", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain('Head to your feed and hit "Run my hunt"');
  });
});

describe("INTERVIEW_TOOLS", () => {
  it("includes record_calibration requiring all four ingest fields", () => {
    const tool = INTERVIEW_TOOLS.find((t) => t.name === "record_calibration");
    expect(tool?.input_schema.required).toEqual(
      expect.arrayContaining(["skills", "evidence", "range_statement", "background_summary"])
    );
  });

  it("keeps record_resume optional (only cv_markdown required)", () => {
    const tool = INTERVIEW_TOOLS.find((t) => t.name === "record_resume");
    expect(tool?.input_schema.required).toEqual(["cv_markdown"]);
  });

  it("keeps record_identity requiring only name (email comes from auth)", () => {
    const tool = INTERVIEW_TOOLS.find((t) => t.name === "record_identity");
    expect(tool?.input_schema.required).toEqual(["name"]);
  });

  it("record_targeting requires only tiers + thesis_summary now (dealbreakers module owns hard_disqualifiers/soft_concerns)", () => {
    const tool = INTERVIEW_TOOLS.find((t) => t.name === "record_targeting");
    expect(tool?.input_schema.required).toEqual(["tiers", "thesis_summary"]);
  });

  it("still accepts hard_disqualifiers/soft_concerns as optional schema fields (harmless empty-array fallback)", () => {
    const tool = INTERVIEW_TOOLS.find((t) => t.name === "record_targeting");
    const props = tool?.input_schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("hard_disqualifiers");
    expect(props).toHaveProperty("soft_concerns");
    expect(tool?.input_schema.required).not.toContain("hard_disqualifiers");
    expect(tool?.input_schema.required).not.toContain("soft_concerns");
  });

  it("keeps finish_interview", () => {
    expect(INTERVIEW_TOOLS.some((t) => t.name === "finish_interview")).toBe(true);
  });

  it("does NOT include the calibration-prompt-generation tool — that's a separate focused tool list", () => {
    expect(INTERVIEW_TOOLS.some((t) => t.name === "record_calibration_prompts")).toBe(false);
  });
});

describe("CALIBRATION_GENERATION_SYSTEM_PROMPT — ONB-A decision #1 + §2 stage 2 framing", () => {
  it("explicitly instructs never calling the step a test or assessment", () => {
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/never call this step a test or an assessment/i);
  });

  it("handles the no-title free-text escape path by calibrating at a junior level from what it mentions", () => {
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/free.text/i);
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/junior level/i);
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/internships/i);
  });

  it("specifies exactly four prompts: depth, breadth, range/realignment, evidence", () => {
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toContain("DEPTH PROBE");
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toContain("BREADTH PROBE");
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/RANGE\/?REALIGNMENT PROBE/);
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toContain("EVIDENCE PROBE");
  });

  it("carries the employer-confidentiality line", () => {
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/describe the shape, not the secrets/i);
  });

  it("bans exclamation marks and the tone ban-list (user-facing card text)", () => {
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/no exclamation marks/i);
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT.toLowerCase()).toContain("passion");
  });
});

describe("CALIBRATION_GENERATION_TOOLS", () => {
  it("requires exactly four prompts", () => {
    const tool = CALIBRATION_GENERATION_TOOLS.find((t) => t.name === "record_calibration_prompts");
    const props = tool?.input_schema.properties as Record<string, { minItems?: number; maxItems?: number }>;
    expect(props.prompts.minItems).toBe(4);
    expect(props.prompts.maxItems).toBe(4);
  });
});

describe("RESUME_EXTRACTION_SYSTEM_PROMPT + RESUME_EXTRACTION_TOOLS — backs regenerateCv.ts", () => {
  it("instructs extracting a clean cv.md body and background_summary", () => {
    expect(RESUME_EXTRACTION_SYSTEM_PROMPT).toMatch(/cv\.md/i);
    expect(RESUME_EXTRACTION_SYSTEM_PROMPT).toMatch(/background_summary/i);
  });

  it("requires cv_markdown on the extraction tool", () => {
    const tool = RESUME_EXTRACTION_TOOLS.find((t) => t.name === "record_resume_extraction");
    expect(tool?.input_schema.required).toEqual(["cv_markdown"]);
  });
});
