import { describe, expect, it } from "vitest";
import { applyToolCalls } from "./applyToolCalls";

describe("applyToolCalls", () => {
  it("ONB-A: advances calibration -> resume on record_calibration", () => {
    const result = applyToolCalls(
      [
        {
          name: "record_calibration",
          input: {
            skills: ["Go"],
            evidence: ["Shipped a thing"],
            range_statement: "Open to adjacent work",
            background_summary: "Backend engineer.",
          },
        },
      ],
      {},
      "calibration"
    );
    expect(result.stage).toBe("resume");
    expect(result.extracted.calibration?.skills).toEqual(["Go"]);
    expect(result.extracted.calibration?.background_summary).toBe("Backend engineer.");
    expect(result.done).toBe(false);
  });

  it("ONB-A: record_calibration preserves the already-generated prompts instead of dropping them", () => {
    const previous = { calibration: { prompts: ["depth?", "breadth?", "range?", "evidence?"] } };
    const result = applyToolCalls(
      [
        {
          name: "record_calibration",
          input: { skills: [], evidence: [], range_statement: "r", background_summary: "b" },
        },
      ],
      previous,
      "calibration"
    );
    expect(result.extracted.calibration?.prompts).toEqual(["depth?", "breadth?", "range?", "evidence?"]);
  });

  it("ONB-A: advances resume -> targeting on record_resume (resume no longer feeds a separate identity stage)", () => {
    const result = applyToolCalls(
      [{ name: "record_resume", input: { cv_markdown: "# CV" } }],
      {},
      "resume"
    );
    expect(result.stage).toBe("targeting");
    expect(result.extracted.resume?.cv_markdown).toBe("# CV");
    expect(result.done).toBe(false);
  });

  it("ONB-A: record_identity no longer moves the stage — it now fires during targeting, not its own stage", () => {
    const result = applyToolCalls(
      [{ name: "record_identity", input: { name: "A", email: "a@example.com" } }],
      {},
      "targeting"
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

  it("preserves previously extracted state across calls through the full v2 chain", () => {
    const afterCalibration = applyToolCalls(
      [
        {
          name: "record_calibration",
          input: { skills: ["Go"], evidence: [], range_statement: "r", background_summary: "b" },
        },
      ],
      {},
      "calibration"
    );
    const afterResume = applyToolCalls(
      [{ name: "record_resume", input: { cv_markdown: "# CV" } }],
      afterCalibration.extracted,
      afterCalibration.stage
    );
    const afterIdentity = applyToolCalls(
      [{ name: "record_identity", input: { name: "A", email: "a@example.com" } }],
      afterResume.extracted,
      afterResume.stage
    );
    expect(afterIdentity.extracted.calibration?.skills).toEqual(["Go"]);
    expect(afterIdentity.extracted.resume?.cv_markdown).toBe("# CV");
    expect(afterIdentity.extracted.identity?.name).toBe("A");
    expect(afterIdentity.stage).toBe("targeting");
  });
});
