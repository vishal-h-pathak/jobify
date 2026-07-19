import { describe, expect, it } from "vitest";
import { PERSONA_NAMES, createPersona } from "./index";

describe("persona registry", () => {
  it("lists exactly the four scripted personas", () => {
    expect(PERSONA_NAMES).toEqual(["cooperative", "terse", "meandering", "corrective"]);
  });

  it("createPersona builds a fresh, independently-stateful instance per call", () => {
    const a = createPersona("corrective");
    const b = createPersona("corrective");

    a.answer({ stage: "targeting", lastAssistantText: "Logistics, all in one go: salary floor?", turnInStage: 1 });
    // `a` has now seen logistics; `b` has not — they must not share state.
    const bAnswer = b.answer({ stage: "targeting", lastAssistantText: "Which direction fits?", turnInStage: 1 });
    expect(bAnswer.toLowerCase()).not.toContain("correction");
  });

  it("throws on an unknown persona name", () => {
    expect(() => createPersona("nonexistent" as never)).toThrow();
  });
});
