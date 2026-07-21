import { describe, expect, it } from "vitest";
import { INTENT_REGISTRY, buildExtractedUpdatesSchema, renderFallbackQuestion } from "./intentRegistry";
import type { ExtractedState } from "../profile/buildDoc";

describe("INTENT_REGISTRY", () => {
  it("has exactly the four checklist intents, each with a schema and both guidance functions", () => {
    for (const key of ["calibration", "resume", "identity", "targeting"] as const) {
      const intent = INTENT_REGISTRY[key];
      expect(intent.key).toBe(key);
      expect(intent.schema.type).toBe("object");
      expect(typeof intent.extractionGuidance).toBe("string");
      expect(intent.extractionGuidance.length).toBeGreaterThan(0);
      expect(typeof intent.askGuidance({})).toBe("string");
      expect(typeof intent.renderFallbackQuestion({})).toBe("string");
    }
  });

  it("targeting's schema requires only tiers + thesis_summary (dealbreakers module owns hard/soft constraints)", () => {
    expect(INTENT_REGISTRY.targeting.schema.required).toEqual(["tiers", "thesis_summary"]);
  });

  it("targeting's extraction guidance explicitly defers dealbreakers to their own module (U2 item 6)", () => {
    expect(INTENT_REGISTRY.targeting.extractionGuidance).toMatch(/dealbreakers module owns/i);
  });

  it("identity's extraction guidance still bans work-authorization/visa/start-date/AI-policy questions", () => {
    const guidance = INTENT_REGISTRY.identity.extractionGuidance;
    expect(guidance).toMatch(/work authorization/i);
    expect(guidance).toMatch(/visa sponsorship/i);
    expect(guidance).toMatch(/start date/i);
    expect(guidance).toMatch(/AI-policy/i);
    expect(guidance).toMatch(/volunteer-only/i);
  });

  it("resume's schema accepts a chat-native skipped flag alongside cv_markdown", () => {
    const props = INTENT_REGISTRY.resume.schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("cv_markdown");
    expect(props).toHaveProperty("skipped");
  });
});

describe("identity askGuidance / renderFallbackQuestion — context-derived, not a single global string", () => {
  it("asks both name and logistics batched together when both are missing", () => {
    const text = renderFallbackQuestion("identity", {});
    expect(text).toMatch(/logistics/i);
    expect(text).toMatch(/name/i);
  });

  it("asks only logistics once name is already known", () => {
    const extracted: ExtractedState = { identity: { name: "Alex Quinn", email: "" } };
    const text = renderFallbackQuestion("identity", extracted);
    expect(text).toMatch(/logistics/i);
    expect(text).not.toMatch(/what's your name/i);
  });

  it("asks only for name once logistics are already known", () => {
    const extracted: ExtractedState = {
      identity: { name: "", email: "", location_and_compensation: { base: "Denver, CO" } },
    };
    const text = renderFallbackQuestion("identity", extracted);
    expect(text.toLowerCase()).toContain("what's your name");
    expect(text).not.toMatch(/salary floor/i);
  });
});

describe("targeting askGuidance / renderFallbackQuestion — references known anchor context when present", () => {
  it("references the anchor's current_title when known", () => {
    const extracted: ExtractedState = { anchor: { current_title: "Staff Software Engineer" } };
    expect(renderFallbackQuestion("targeting", extracted)).toContain("Staff Software Engineer");
  });

  it("degrades gracefully with no anchor context", () => {
    expect(renderFallbackQuestion("targeting", {})).toMatch(/what you're optimizing for/i);
  });
});

describe("calibration renderFallbackQuestion — reuses the first generated calibration prompt", () => {
  it("uses extracted.calibration.prompts[0] when present", () => {
    const extracted: ExtractedState = { calibration: { prompts: ["Tell me about a hard bug.", "b", "c", "d"] } };
    expect(renderFallbackQuestion("calibration", extracted)).toBe("Tell me about a hard bug.");
  });

  it("falls back to a generic prompt when no prompts were generated yet", () => {
    expect(renderFallbackQuestion("calibration", {})).toMatch(/tell me about the core of your work/i);
  });
});

describe("buildExtractedUpdatesSchema", () => {
  it("scopes properties to the current intent plus anything_else only", () => {
    const schema = buildExtractedUpdatesSchema("identity") as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(["anything_else", "identity"]);
  });

  it("anything_else exposes all four intents' shapes for opportunistic capture", () => {
    const schema = buildExtractedUpdatesSchema("calibration") as {
      properties: { anything_else: { properties: Record<string, unknown> } };
    };
    expect(Object.keys(schema.properties.anything_else.properties).sort()).toEqual([
      "calibration",
      "identity",
      "resume",
      "targeting",
    ]);
  });

  it("produces a distinct schema per target intent", () => {
    const calibrationSchema = buildExtractedUpdatesSchema("calibration") as { properties: Record<string, unknown> };
    const targetingSchema = buildExtractedUpdatesSchema("targeting") as { properties: Record<string, unknown> };
    expect(calibrationSchema.properties).toHaveProperty("calibration");
    expect(calibrationSchema.properties).not.toHaveProperty("targeting");
    expect(targetingSchema.properties).toHaveProperty("targeting");
    expect(targetingSchema.properties).not.toHaveProperty("calibration");
  });
});
