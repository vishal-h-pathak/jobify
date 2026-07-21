import { describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
vi.mock("./client", () => ({
  anthropicClient: () => ({ messages: { create: createMock } }),
  ONBOARDING_MODEL: "claude-sonnet-5",
}));

const {
  CALIBRATION_GENERATION_SYSTEM_PROMPT,
  CALIBRATION_GENERATION_TOOLS,
  RESUME_EXTRACTION_SYSTEM_PROMPT,
  RESUME_EXTRACTION_TOOLS,
  SEEDED_GREETING,
  ENGINE_TOOL_NAME,
  ENGINE_MAX_TOKENS,
  buildEngineSystemPrompt,
  buildEngineTool,
  runEngineTurn,
  runCalibrationGeneration,
  runResumeExtractionTurn,
} = await import("./interview");

function usageResponse(content: unknown[], usage = { input_tokens: 111, output_tokens: 22 }, stop_reason = "tool_use") {
  return { content, usage, stop_reason };
}

describe("SEEDED_GREETING — kept only for pre-B onboarding UI compile compatibility", () => {
  it("is still a non-empty exported string (page.tsx imports it; v2+ flow never produces it)", () => {
    expect(typeof SEEDED_GREETING).toBe("string");
    expect(SEEDED_GREETING.length).toBeGreaterThan(0);
  });
});

describe("buildEngineSystemPrompt — engine contract point 3: server tells the model WHAT to ask", () => {
  it("contains the tone ban-list (unchanged, hard requirement)", () => {
    const prompt = buildEngineSystemPrompt({ currentIntent: "calibration", nextIntent: "resume", extracted: {} });
    const lower = prompt.toLowerCase();
    for (const word of ["passion", "dream", "journey", "fulfilling", "lights you up", "calling", "purpose"]) {
      expect(lower).toContain(word);
    }
    expect(prompt).toMatch(/no exclamation marks/i);
  });

  it("instructs the model to call interview_turn exactly once, extracting into the current intent's key", () => {
    const prompt = buildEngineSystemPrompt({ currentIntent: "identity", nextIntent: "targeting", extracted: {} });
    expect(prompt).toContain("`interview_turn`");
    expect(prompt).toContain("extracted_updates.identity");
  });

  it("instructs the model to ask about the next intent when one remains", () => {
    const prompt = buildEngineSystemPrompt({ currentIntent: "calibration", nextIntent: "resume", extracted: {} });
    expect(prompt).toMatch(/have a resume handy/i);
  });

  it("includes the NEVER RE-ASK instruction only once there's known context to never re-ask", () => {
    const prompt = buildEngineSystemPrompt({
      currentIntent: "resume",
      nextIntent: "identity",
      extracted: { identity: { name: "Alex Quinn", email: "" } },
    });
    expect(prompt).toMatch(/NEVER RE-ASK KNOWN FIELDS/);
  });

  it("instructs a closing summary (not a question) once nextIntent is null", () => {
    const prompt = buildEngineSystemPrompt({ currentIntent: "targeting", nextIntent: null, extracted: {} });
    expect(prompt).toMatch(/nothing left to ask/i);
    expect(prompt).toContain('Head to your feed and hit \\"Run my hunt\\"');
  });

  it("dumps known context so the model structurally cannot re-ask it (U2 items 4/5/7)", () => {
    const prompt = buildEngineSystemPrompt({
      currentIntent: "resume",
      nextIntent: "identity",
      extracted: {
        anchor: { current_title: "Staff Engineer", current_company: "Acme" },
        identity: { name: "Alex Quinn", email: "" },
      },
    });
    expect(prompt).toContain("KNOWN CONTEXT");
    expect(prompt).toContain("Staff Engineer");
    expect(prompt).toContain("Alex Quinn");
  });

  it("omits the KNOWN CONTEXT section entirely on a brand-new session (nothing to dump yet)", () => {
    const prompt = buildEngineSystemPrompt({ currentIntent: "calibration", nextIntent: "resume", extracted: {} });
    expect(prompt).not.toContain("KNOWN CONTEXT");
  });

  it("identity's extraction guidance still bans work-authorization/visa/start-date questions (CRITICAL RULE)", () => {
    const prompt = buildEngineSystemPrompt({ currentIntent: "identity", nextIntent: "targeting", extracted: {} });
    expect(prompt).toMatch(/work authorization/i);
    expect(prompt).toMatch(/visa sponsorship/i);
    expect(prompt).toMatch(/volunteer-only/i);
  });

  it("targeting's extraction guidance states dealbreakers are no longer asked here", () => {
    const prompt = buildEngineSystemPrompt({ currentIntent: "targeting", nextIntent: null, extracted: {} });
    expect(prompt).toMatch(/dealbreakers module owns/i);
  });
});

describe("buildEngineTool — the forced interview_turn tool", () => {
  it("names the tool interview_turn and requires question + extracted_updates", () => {
    const tool = buildEngineTool("calibration");
    expect(tool.name).toBe(ENGINE_TOOL_NAME);
    expect(tool.input_schema.required).toEqual(["question", "extracted_updates"]);
  });

  it("scopes extracted_updates to the current intent plus anything_else", () => {
    const tool = buildEngineTool("targeting");
    const props = (tool.input_schema.properties as Record<string, { properties: Record<string, unknown> }>)
      .extracted_updates.properties;
    expect(Object.keys(props).sort()).toEqual(["anything_else", "targeting"]);
  });
});

describe("runEngineTurn", () => {
  it("forces tool_choice to interview_turn and sends max_tokens 4096 (engine contract point 2)", async () => {
    createMock.mockResolvedValue(
      usageResponse([{ type: "tool_use", name: "interview_turn", input: { question: "Where are you based?", extracted_updates: {} } }])
    );

    const result = await runEngineTurn({
      history: [{ role: "user", content: "hi" }],
      extracted: {},
      currentIntent: "identity",
      nextIntent: "targeting",
    });

    expect(ENGINE_MAX_TOKENS).toBe(4096);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 4096,
        tool_choice: { type: "tool", name: "interview_turn" },
      })
    );
    expect(result.question).toBe("Where are you based?");
    expect(result.maxTokens).toBe(4096);
  });

  it("extracts question + extractedUpdates from the forced tool call", async () => {
    createMock.mockResolvedValue(
      usageResponse([
        {
          type: "tool_use",
          name: "interview_turn",
          input: { question: "Have a resume handy?", extracted_updates: { calibration: { skills: ["Go"] } } },
        },
      ])
    );

    const result = await runEngineTurn({
      history: [{ role: "user", content: "here are my four answers" }],
      extracted: {},
      currentIntent: "calibration",
      nextIntent: "resume",
    });

    expect(result.extractedUpdates).toEqual({ calibration: { skills: ["Go"] } });
    expect(result.usage).toEqual({ inputTokens: 111, outputTokens: 22 });
  });

  it("returns an empty question and empty extractedUpdates if the model somehow returns neither (defensive)", async () => {
    createMock.mockResolvedValue(usageResponse([{ type: "tool_use", name: "interview_turn", input: {} }]));

    const result = await runEngineTurn({
      history: [{ role: "user", content: "ok" }],
      extracted: {},
      currentIntent: "targeting",
      nextIntent: null,
    });

    expect(result.question).toBe("");
    expect(result.extractedUpdates).toEqual({});
  });

  it("warns when stop_reason is max_tokens (truncation risk)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockResolvedValue(
      usageResponse(
        [{ type: "tool_use", name: "interview_turn", input: { question: "q", extracted_updates: {} } }],
        { input_tokens: 10, output_tokens: 4096 },
        "max_tokens"
      )
    );

    await runEngineTurn({ history: [], extracted: {}, currentIntent: "targeting", nextIntent: null });

    expect(warnSpy).toHaveBeenCalledWith("runEngineTurn: response truncated at max_tokens — question/extracted_updates may be lost", expect.objectContaining({ outputTokens: 4096 }));
    warnSpy.mockRestore();
  });
});

describe("runCalibrationGeneration — exposes maxTokens on the result (unchanged, out of INT2 scope)", () => {
  it("returns maxTokens matching the cap passed to messages.create", async () => {
    createMock.mockResolvedValue(
      usageResponse([{ type: "tool_use", name: "record_calibration_prompts", input: { prompts: ["a", "b", "c", "d"] } }])
    );

    const result = await runCalibrationGeneration({ current_title: "Engineer", current_company: "Acme" });

    expect(result.maxTokens).toBe(2048);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 2048 }));
  });
});

describe("CALIBRATION_GENERATION_SYSTEM_PROMPT + CALIBRATION_GENERATION_TOOLS (unchanged, out of INT2 scope)", () => {
  it("explicitly instructs never calling the step a test or assessment", () => {
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/never call this step a test or an assessment/i);
  });

  it("specifies exactly four prompts: depth, breadth, range/realignment, evidence", () => {
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toContain("DEPTH PROBE");
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toContain("BREADTH PROBE");
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toMatch(/RANGE\/?REALIGNMENT PROBE/);
    expect(CALIBRATION_GENERATION_SYSTEM_PROMPT).toContain("EVIDENCE PROBE");
  });

  it("requires exactly four prompts on the schema", () => {
    const tool = CALIBRATION_GENERATION_TOOLS.find((t) => t.name === "record_calibration_prompts");
    const props = tool?.input_schema.properties as Record<string, { minItems?: number; maxItems?: number }>;
    expect(props.prompts.minItems).toBe(4);
    expect(props.prompts.maxItems).toBe(4);
  });
});

describe("RESUME_EXTRACTION_SYSTEM_PROMPT + RESUME_EXTRACTION_TOOLS — backs regenerateCv.ts (unchanged, out of INT2 scope)", () => {
  it("instructs extracting a clean cv.md body and background_summary", () => {
    expect(RESUME_EXTRACTION_SYSTEM_PROMPT).toMatch(/cv\.md/i);
    expect(RESUME_EXTRACTION_SYSTEM_PROMPT).toMatch(/background_summary/i);
  });

  it("requires cv_markdown on the extraction tool", () => {
    const tool = RESUME_EXTRACTION_TOOLS.find((t) => t.name === "record_resume_extraction");
    expect(tool?.input_schema.required).toEqual(["cv_markdown"]);
  });

  it("runResumeExtractionTurn returns the extracted cv_markdown/background_summary", async () => {
    createMock.mockResolvedValue(
      usageResponse([
        { type: "tool_use", name: "record_resume_extraction", input: { cv_markdown: "# CV", background_summary: "b" } },
      ])
    );
    const result = await runResumeExtractionTurn("resume text");
    expect(result.cv_markdown).toBe("# CV");
    expect(result.background_summary).toBe("b");
  });
});
