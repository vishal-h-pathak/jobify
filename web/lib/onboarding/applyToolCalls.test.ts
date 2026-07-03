import { describe, expect, it } from "vitest";
import { applyToolCalls } from "./applyToolCalls";

describe("applyToolCalls", () => {
  it("advances resume -> identity on record_resume", () => {
    const result = applyToolCalls(
      [{ name: "record_resume", input: { cv_markdown: "# CV" } }],
      {},
      "resume"
    );
    expect(result.stage).toBe("identity");
    expect(result.extracted.resume?.cv_markdown).toBe("# CV");
    expect(result.done).toBe(false);
  });

  it("advances identity -> targeting on record_identity", () => {
    const result = applyToolCalls(
      [{ name: "record_identity", input: { name: "A", email: "a@example.com" } }],
      {},
      "identity"
    );
    expect(result.stage).toBe("targeting");
    expect(result.extracted.identity?.name).toBe("A");
  });

  it("does not advance past targeting on record_targeting alone", () => {
    const result = applyToolCalls(
      [
        {
          name: "record_targeting",
          input: { tiers: [{ key: "tier_1", label: "x" }], hard_disqualifiers: [], soft_concerns: [], thesis_summary: "t" },
        },
      ],
      {},
      "targeting"
    );
    expect(result.stage).toBe("targeting");
    expect(result.done).toBe(false);
  });

  it("finish_interview marks done and stage=done", () => {
    const result = applyToolCalls([{ name: "finish_interview", input: {} }], {}, "targeting");
    expect(result.done).toBe(true);
    expect(result.stage).toBe("done");
  });

  it("preserves previously extracted state across calls", () => {
    const afterResume = applyToolCalls([{ name: "record_resume", input: { cv_markdown: "# CV" } }], {}, "resume");
    const afterIdentity = applyToolCalls(
      [{ name: "record_identity", input: { name: "A", email: "a@example.com" } }],
      afterResume.extracted,
      afterResume.stage
    );
    expect(afterIdentity.extracted.resume?.cv_markdown).toBe("# CV");
    expect(afterIdentity.extracted.identity?.name).toBe("A");
  });
});
