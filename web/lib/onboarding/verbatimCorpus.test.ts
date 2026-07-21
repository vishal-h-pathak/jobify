import { describe, expect, it } from "vitest";
import { buildVerbatimCorpus } from "./verbatimCorpus";

describe("buildVerbatimCorpus", () => {
  it("includes user chat message text (existing behavior, never removed)", () => {
    const corpus = buildVerbatimCorpus({
      messages: [
        { role: "assistant", content: "What are you looking for?" },
        { role: "user", content: "I want more autonomy on hard problems." },
      ],
      extracted: {},
    });
    expect(corpus).toContain("I want more autonomy on hard problems.");
  });

  it("a card-only session (no chat messages at all) still yields a corpus containing its phrases", () => {
    const corpus = buildVerbatimCorpus({
      messages: [],
      extracted: {
        anchor: { free_text: "between roles after a layoff" },
        trajectory: { direction: "switch", free_text: "ready to leave big-co politics behind" },
        dealbreakers: { hard_disqualifiers: ["on-site required", "only Atlanta"], soft_concerns: ["no more 24/7 pager duty"] },
        energy: { hours_disappear: "debugging flaky CI at 2am", kept_putting_off: "writing the design doc" },
        calibration: { range_statement: "senior IC comp, not staff, not junior" },
        voice: { sample: "I just ship it and move on, honestly." },
      },
    });
    expect(corpus).toContain("between roles after a layoff");
    expect(corpus).toContain("ready to leave big-co politics behind");
    expect(corpus).toContain("on-site required");
    expect(corpus).toContain("only Atlanta");
    expect(corpus).toContain("no more 24/7 pager duty");
    expect(corpus).toContain("debugging flaky CI at 2am");
    expect(corpus).toContain("writing the design doc");
    expect(corpus).toContain("senior IC comp, not staff, not junior");
    expect(corpus).toContain("I just ship it and move on, honestly.");
  });

  it("tolerates a completely empty session (no messages, no extracted) without throwing", () => {
    expect(() => buildVerbatimCorpus({ messages: [], extracted: {} })).not.toThrow();
    expect(buildVerbatimCorpus({ messages: [], extracted: {} })).toBe("");
  });

  it("ignores non-string / malformed fields rather than crashing", () => {
    const corpus = buildVerbatimCorpus({
      messages: [],
      extracted: {
        anchor: { free_text: 42 },
        dealbreakers: { hard_disqualifiers: "not an array", soft_concerns: [1, 2, "a real one"] },
        energy: null,
        voice: "not an object",
      },
    });
    expect(corpus).toContain("a real one");
    expect(corpus).not.toContain("42");
  });

  it("skips modules that were never reached (missing from extracted entirely)", () => {
    const corpus = buildVerbatimCorpus({ messages: [], extracted: { anchor: { free_text: "only this" } } });
    expect(corpus.trim()).toBe("only this");
  });
});
