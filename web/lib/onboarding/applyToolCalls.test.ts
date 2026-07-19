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

  it("INTSIM live-run fix: a malformed/incomplete record_calibration re-call (e.g. a truncated tool call) falls back to the previously-recorded fields instead of wiping them to empty", () => {
    const previous = {
      calibration: {
        prompts: ["depth?", "breadth?", "range?", "evidence?"],
        skills: ["Go", "Python"],
        evidence: ["Shipped the Kafka pipeline rebuild"],
        range_statement: "Open to adjacent work",
        background_summary: "Backend engineer with platform depth.",
      },
    };
    // Simulates a truncated response: skills/evidence/range_statement/
    // background_summary all missing from this call's input, as would
    // happen if the tool call itself got cut off mid-generation.
    const result = applyToolCalls([{ name: "record_calibration", input: {} }], previous, "resume");

    expect(result.extracted.calibration?.skills).toEqual(["Go", "Python"]);
    expect(result.extracted.calibration?.evidence).toEqual(["Shipped the Kafka pipeline rebuild"]);
    expect(result.extracted.calibration?.range_statement).toBe("Open to adjacent work");
    expect(result.extracted.calibration?.background_summary).toBe("Backend engineer with platform depth.");
  });

  it("a record_calibration call with a genuinely empty skills/evidence array still records that empty array (not a fallback case)", () => {
    const previous = { calibration: { skills: ["Go"], evidence: ["old evidence"] } };
    const result = applyToolCalls(
      [{ name: "record_calibration", input: { skills: [], evidence: [], range_statement: "r", background_summary: "b" } }],
      previous,
      "calibration"
    );
    expect(result.extracted.calibration?.skills).toEqual([]);
    expect(result.extracted.calibration?.evidence).toEqual([]);
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

  it("INTSIM MONOTONIC-STATE fix: a second record_identity call merges into the previous identity instead of wholesale-replacing it (live bug: a partial re-call destroyed location_and_compensation mid-interview)", () => {
    const first = applyToolCalls(
      [
        {
          name: "record_identity",
          input: {
            name: "Alex Quinn",
            email: "alex.quinn@example.com",
            location_and_compensation: {
              base: "Denver, CO",
              remote_acceptable: true,
              target_comp_usd: "175000-205000",
            },
          },
        },
      ],
      {},
      "targeting"
    );
    expect(first.extracted.identity?.location_and_compensation?.target_comp_usd).toBe("175000-205000");

    // A correction turn later re-calls record_identity with only the
    // corrected field(s) — the model does not necessarily restate
    // location_and_compensation verbatim every time.
    const corrected = applyToolCalls(
      [{ name: "record_identity", input: { name: "Alex Quinn", email: "alex.quinn@example.com" } }],
      first.extracted,
      "targeting"
    );

    expect(corrected.extracted.identity?.name).toBe("Alex Quinn");
    expect(corrected.extracted.identity?.location_and_compensation?.target_comp_usd).toBe("175000-205000");
    expect(corrected.extracted.identity?.location_and_compensation?.base).toBe("Denver, CO");
  });

  it("record_identity's location_and_compensation itself merges field-by-field (a correction to just target_comp_usd doesn't drop remote_acceptable)", () => {
    const first = applyToolCalls(
      [
        {
          name: "record_identity",
          input: {
            name: "Alex Quinn",
            email: "alex.quinn@example.com",
            location_and_compensation: { base: "Denver, CO", remote_acceptable: true, target_comp_usd: "175000-205000" },
          },
        },
      ],
      {},
      "targeting"
    );

    const corrected = applyToolCalls(
      [
        {
          name: "record_identity",
          input: {
            name: "Alex Quinn",
            email: "alex.quinn@example.com",
            location_and_compensation: { target_comp_usd: "190000-210000" },
          },
        },
      ],
      first.extracted,
      "targeting"
    );

    expect(corrected.extracted.identity?.location_and_compensation).toEqual({
      base: "Denver, CO",
      remote_acceptable: true,
      target_comp_usd: "190000-210000",
    });
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
