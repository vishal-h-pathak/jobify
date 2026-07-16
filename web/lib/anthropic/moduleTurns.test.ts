import { describe, expect, it, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("./client", () => ({
  anthropicClient: () => ({ messages: { create: createMock } }),
  ONBOARDING_MODEL: "claude-sonnet-5",
}));

const {
  runVoiceIngestTurn,
  runMetricsExtractionTurn,
  runMirrorGenerationTurn,
  VOICE_INGEST_SYSTEM_PROMPT,
  VOICE_INGEST_TOOLS,
  METRICS_EXTRACTION_SYSTEM_PROMPT,
  METRICS_EXTRACTION_TOOLS,
  MIRROR_GENERATION_SYSTEM_PROMPT,
  MIRROR_GENERATION_TOOLS,
} = await import("./moduleTurns");

function usageResponse(content: unknown[], usage = { input_tokens: 111, output_tokens: 22 }) {
  return { content, usage };
}

describe("runVoiceIngestTurn", () => {
  beforeEach(() => createMock.mockReset());

  it("calls the model with the forced record_voice tool and extracts all five fields + usage", async () => {
    createMock.mockResolvedValue(
      usageResponse([
        { type: "text", text: "noted" },
        {
          type: "tool_use",
          name: "record_voice",
          input: {
            register: "dry, compressed",
            rhythm: "short declarative sentences",
            words_used: ["ship", "cut"],
            words_avoided: ["synergy"],
            signature_phrases: ["I shipped it Tuesday"],
          },
        },
      ])
    );

    const result = await runVoiceIngestTurn("I shipped it Tuesday and cut the build time in half.");

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        system: VOICE_INGEST_SYSTEM_PROMPT,
        tools: VOICE_INGEST_TOOLS,
        messages: [{ role: "user", content: "I shipped it Tuesday and cut the build time in half." }],
      })
    );

    expect(result).toEqual({
      register: "dry, compressed",
      rhythm: "short declarative sentences",
      words_used: ["ship", "cut"],
      words_avoided: ["synergy"],
      signature_phrases: ["I shipped it Tuesday"],
      usage: { inputTokens: 111, outputTokens: 22 },
    });
  });

  it("does NOT filter signature_phrases against the sample — that's the route's job", async () => {
    createMock.mockResolvedValue(
      usageResponse([
        {
          type: "tool_use",
          name: "record_voice",
          input: {
            register: "dry",
            rhythm: "short",
            words_used: [],
            words_avoided: [],
            signature_phrases: ["a phrase never actually in the sample"],
          },
        },
      ])
    );

    const result = await runVoiceIngestTurn("totally unrelated sample text");
    expect(result.signature_phrases).toEqual(["a phrase never actually in the sample"]);
  });

  it("returns sensible empty defaults when the tool call is missing, rather than throwing", async () => {
    createMock.mockResolvedValue(usageResponse([{ type: "text", text: "no tool call here" }]));

    const result = await runVoiceIngestTurn("some sample");
    expect(result).toEqual({
      register: "",
      rhythm: "",
      words_used: [],
      words_avoided: [],
      signature_phrases: [],
      usage: { inputTokens: 111, outputTokens: 22 },
    });
  });

  it("returns sensible empty defaults when the tool call input is malformed", async () => {
    createMock.mockResolvedValue(
      usageResponse([{ type: "tool_use", name: "record_voice", input: { register: 42, words_used: "not-an-array" } }])
    );

    const result = await runVoiceIngestTurn("some sample");
    expect(result.register).toBe("");
    expect(result.words_used).toEqual([]);
  });
});

describe("runMetricsExtractionTurn", () => {
  beforeEach(() => createMock.mockReset());

  it("calls the model with the forced record_metric_claims tool and extracts claims + usage", async () => {
    createMock.mockResolvedValue(
      usageResponse([
        {
          type: "tool_use",
          name: "record_metric_claims",
          input: {
            claims: [
              { id: "claim_1", text: "cut deploy time from 40 minutes to 6", source: "cv", has_number: true },
              { id: "claim_2", text: "shipped the migration to production", source: "anchor", has_number: false },
            ],
          },
        },
      ])
    );

    const result = await runMetricsExtractionTurn("cv.md + extracted fields + chat text, all assembled");

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        system: METRICS_EXTRACTION_SYSTEM_PROMPT,
        tools: METRICS_EXTRACTION_TOOLS,
        messages: [{ role: "user", content: "cv.md + extracted fields + chat text, all assembled" }],
      })
    );

    expect(result).toEqual({
      claims: [
        { id: "claim_1", text: "cut deploy time from 40 minutes to 6", source: "cv", has_number: true },
        { id: "claim_2", text: "shipped the migration to production", source: "anchor", has_number: false },
      ],
      usage: { inputTokens: 111, outputTokens: 22 },
    });
  });

  it("drops malformed claim entries (bad source enum, missing fields) but keeps well-formed ones", async () => {
    createMock.mockResolvedValue(
      usageResponse([
        {
          type: "tool_use",
          name: "record_metric_claims",
          input: {
            claims: [
              { id: "claim_1", text: "good claim", source: "range", has_number: true },
              { id: "claim_2", text: "bad source", source: "resume", has_number: true },
              { id: "claim_3", text: "missing has_number", source: "cv" },
            ],
          },
        },
      ])
    );

    const result = await runMetricsExtractionTurn("input text");
    expect(result.claims).toEqual([{ id: "claim_1", text: "good claim", source: "range", has_number: true }]);
  });

  it("returns an empty claims array when the tool call is missing, rather than throwing", async () => {
    createMock.mockResolvedValue(usageResponse([{ type: "text", text: "nothing found" }]));

    const result = await runMetricsExtractionTurn("input text");
    expect(result).toEqual({ claims: [], usage: { inputTokens: 111, outputTokens: 22 } });
  });

  it("caps claims at 12 even when the model returns more well-formed claims than the schema allows", async () => {
    const wellFormedClaims = Array.from({ length: 15 }, (_, i) => ({
      id: `claim_${i + 1}`,
      text: `claim number ${i + 1}`,
      source: "cv" as const,
      has_number: true,
    }));
    createMock.mockResolvedValue(
      usageResponse([
        { type: "tool_use", name: "record_metric_claims", input: { claims: wellFormedClaims } },
      ])
    );

    const result = await runMetricsExtractionTurn("input text");
    expect(result.claims).toHaveLength(12);
    expect(result.claims).toEqual(wellFormedClaims.slice(0, 12));
  });
});

describe("runMirrorGenerationTurn", () => {
  beforeEach(() => createMock.mockReset());

  it("calls the model with the forced record_mirror tool and extracts paragraphs + quoted_phrases + usage", async () => {
    createMock.mockResolvedValue(
      usageResponse([
        {
          type: "tool_use",
          name: "record_mirror",
          input: {
            paragraphs: [
              "You said it yourself: \"I shipped it Tuesday.\" That's the shape of how you work.",
              "You want more of the same, not a reinvention. That's what the evidence points to.",
            ],
            quoted_phrases: ["I shipped it Tuesday"],
          },
        },
      ])
    );

    const result = await runMirrorGenerationTurn({ extractedSummary: "Anchor: ...\nValues: ...\nEnergy: ..." });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        system: MIRROR_GENERATION_SYSTEM_PROMPT,
        tools: MIRROR_GENERATION_TOOLS,
        messages: [{ role: "user", content: "Anchor: ...\nValues: ...\nEnergy: ..." }],
      })
    );

    expect(result).toEqual({
      paragraphs: [
        "You said it yourself: \"I shipped it Tuesday.\" That's the shape of how you work.",
        "You want more of the same, not a reinvention. That's what the evidence points to.",
      ],
      quoted_phrases: ["I shipped it Tuesday"],
      usage: { inputTokens: 111, outputTokens: 22 },
    });
  });

  it("returns sensible empty defaults (two empty strings, no quotes) when the tool call is missing", async () => {
    createMock.mockResolvedValue(usageResponse([{ type: "text", text: "nothing" }]));

    const result = await runMirrorGenerationTurn({ extractedSummary: "Anchor: ..." });
    expect(result).toEqual({
      paragraphs: ["", ""],
      quoted_phrases: [],
      usage: { inputTokens: 111, outputTokens: 22 },
    });
  });

  it("returns default paragraphs when the tool call's paragraphs field is malformed (not a 2-string tuple)", async () => {
    createMock.mockResolvedValue(
      usageResponse([
        {
          type: "tool_use",
          name: "record_mirror",
          input: { paragraphs: ["only one paragraph"], quoted_phrases: ["a quote"] },
        },
      ])
    );

    const result = await runMirrorGenerationTurn({ extractedSummary: "Anchor: ..." });
    expect(result.paragraphs).toEqual(["", ""]);
    expect(result.quoted_phrases).toEqual(["a quote"]);
  });
});
