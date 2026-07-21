import { describe, expect, it } from "vitest";
import { mergeExtractedUpdates, mergeCalibration, mergeResume, mergeIdentity, mergeTargeting } from "./applyToolCalls";
import type { ExtractedState } from "../profile/buildDoc";

describe("mergeExtractedUpdates — calibration", () => {
  it("records skills/evidence/range_statement/background_summary", () => {
    const result = mergeExtractedUpdates(
      {},
      {
        calibration: {
          skills: ["Go"],
          evidence: ["Shipped a thing"],
          range_statement: "Open to adjacent work",
          background_summary: "Backend engineer.",
        },
      }
    );
    expect(result.calibration?.skills).toEqual(["Go"]);
    expect(result.calibration?.background_summary).toBe("Backend engineer.");
  });

  it("preserves the already-generated prompts instead of dropping them", () => {
    const previous: ExtractedState = { calibration: { prompts: ["depth?", "breadth?", "range?", "evidence?"] } };
    const result = mergeExtractedUpdates(previous, {
      calibration: { skills: [], evidence: [], range_statement: "r", background_summary: "b" },
    });
    expect(result.calibration?.prompts).toEqual(["depth?", "breadth?", "range?", "evidence?"]);
  });

  it("a malformed/incomplete re-call falls back to previously-recorded fields instead of wiping them", () => {
    const previous: ExtractedState = {
      calibration: {
        prompts: ["depth?", "breadth?", "range?", "evidence?"],
        skills: ["Go", "Python"],
        evidence: ["Shipped the Kafka pipeline rebuild"],
        range_statement: "Open to adjacent work",
        background_summary: "Backend engineer with platform depth.",
      },
    };
    const result = mergeExtractedUpdates(previous, { calibration: {} });
    expect(result.calibration?.skills).toEqual(["Go", "Python"]);
    expect(result.calibration?.evidence).toEqual(["Shipped the Kafka pipeline rebuild"]);
    expect(result.calibration?.range_statement).toBe("Open to adjacent work");
    expect(result.calibration?.background_summary).toBe("Backend engineer with platform depth.");
  });

  it("a genuinely empty skills/evidence array is still recorded as given (not a fallback case)", () => {
    const previous: ExtractedState = { calibration: { skills: ["Go"], evidence: ["old evidence"] } };
    const result = mergeExtractedUpdates(previous, {
      calibration: { skills: [], evidence: [], range_statement: "r", background_summary: "b" },
    });
    expect(result.calibration?.skills).toEqual([]);
    expect(result.calibration?.evidence).toEqual([]);
  });
});

describe("mergeExtractedUpdates — resume", () => {
  it("records cv_markdown and marks resumeResolved", () => {
    const result = mergeExtractedUpdates({}, { resume: { cv_markdown: "# CV" } });
    expect(result.resume?.cv_markdown).toBe("# CV");
    expect(result.resumeResolved).toBe(true);
  });

  it("an explicit chat-native skip (skipped:true, no content) marks resumeResolved without setting extracted.resume", () => {
    const result = mergeExtractedUpdates({}, { resume: { skipped: true } });
    expect(result.resumeResolved).toBe(true);
    expect(result.resume).toBeUndefined();
  });

  it("a call with neither content nor an explicit skip is a no-op (does not prematurely resolve)", () => {
    const result = mergeExtractedUpdates({}, { resume: {} });
    expect(result.resumeResolved).toBeUndefined();
    expect(result.resume).toBeUndefined();
  });
});

describe("mergeExtractedUpdates — identity", () => {
  it("records name/email/logistics", () => {
    const result = mergeExtractedUpdates(
      {},
      { identity: { name: "Alex Quinn", email: "alex.quinn@example.com" } }
    );
    expect(result.identity?.name).toBe("Alex Quinn");
  });

  it("MONOTONIC-STATE fix: a second identity update merges instead of wholesale-replacing (a partial re-call must not destroy location_and_compensation)", () => {
    const first = mergeExtractedUpdates(
      {},
      {
        identity: {
          name: "Alex Quinn",
          email: "alex.quinn@example.com",
          location_and_compensation: { base: "Denver, CO", remote_acceptable: true, target_comp_usd: "175000-205000" },
        },
      }
    );
    expect(first.identity?.location_and_compensation?.target_comp_usd).toBe("175000-205000");

    const corrected = mergeExtractedUpdates(first, {
      identity: { name: "Alex Quinn", email: "alex.quinn@example.com" },
    });
    expect(corrected.identity?.name).toBe("Alex Quinn");
    expect(corrected.identity?.location_and_compensation?.target_comp_usd).toBe("175000-205000");
    expect(corrected.identity?.location_and_compensation?.base).toBe("Denver, CO");
  });

  it("location_and_compensation itself merges field-by-field (a correction to target_comp_usd doesn't drop remote_acceptable)", () => {
    const first = mergeExtractedUpdates(
      {},
      {
        identity: {
          name: "Alex Quinn",
          email: "alex.quinn@example.com",
          location_and_compensation: { base: "Denver, CO", remote_acceptable: true, target_comp_usd: "175000-205000" },
        },
      }
    );
    const corrected = mergeExtractedUpdates(first, {
      identity: { location_and_compensation: { target_comp_usd: "190000-210000" } },
    });
    expect(corrected.identity?.location_and_compensation).toEqual({
      base: "Denver, CO",
      remote_acceptable: true,
      target_comp_usd: "190000-210000",
    });
  });
});

describe("mergeExtractedUpdates — targeting", () => {
  it("records tiers + thesis_summary, defaulting hard_disqualifiers/soft_concerns to empty (dealbreakers module owns those)", () => {
    const result = mergeExtractedUpdates({}, { targeting: { tiers: [{ key: "tier_1", label: "x" }], thesis_summary: "t" } });
    expect(result.targeting?.tiers).toEqual([{ key: "tier_1", label: "x" }]);
    expect(result.targeting?.thesis_summary).toBe("t");
    expect(result.targeting?.hard_disqualifiers).toEqual([]);
    expect(result.targeting?.soft_concerns).toEqual([]);
  });

  it("records the optional dream_companies seed", () => {
    const result = mergeExtractedUpdates({}, { targeting: { tiers: [], thesis_summary: "t", dream_companies: ["Acme"] } });
    expect(result.targeting?.dream_companies).toEqual(["Acme"]);
  });
});

describe("mergeExtractedUpdates — anything_else opportunistic capture (engine contract point 5)", () => {
  it("routes anything_else through the SAME per-key mergers as the top-level target", () => {
    const result = mergeExtractedUpdates(
      {},
      {
        calibration: { skills: ["Go"], evidence: [], range_statement: "r", background_summary: "b" },
        anything_else: { identity: { name: "Alex Quinn", email: "alex@example.com" } },
      }
    );
    expect(result.calibration?.skills).toEqual(["Go"]);
    expect(result.identity?.name).toBe("Alex Quinn");
  });

  it("an anything_else update alone (no top-level target key) still merges", () => {
    const result = mergeExtractedUpdates({}, { anything_else: { targeting: { tiers: [], thesis_summary: "t" } } });
    expect(result.targeting?.thesis_summary).toBe("t");
  });
});

describe("mergeExtractedUpdates — full chain preserves state across calls", () => {
  it("calibration -> resume -> identity -> targeting all accumulate", () => {
    let extracted: ExtractedState = {};
    extracted = mergeExtractedUpdates(extracted, {
      calibration: { skills: ["Go"], evidence: [], range_statement: "r", background_summary: "b" },
    });
    extracted = mergeExtractedUpdates(extracted, { resume: { cv_markdown: "# CV" } });
    extracted = mergeExtractedUpdates(extracted, { identity: { name: "A", email: "a@example.com" } });
    extracted = mergeExtractedUpdates(extracted, { targeting: { tiers: [{ key: "tier_1", label: "x" }], thesis_summary: "t" } });

    expect(extracted.calibration?.skills).toEqual(["Go"]);
    expect(extracted.resume?.cv_markdown).toBe("# CV");
    expect(extracted.resumeResolved).toBe(true);
    expect(extracted.identity?.name).toBe("A");
    expect(extracted.targeting?.thesis_summary).toBe("t");
  });
});

describe("individual mergers are exported directly (used by intentRegistry.ts)", () => {
  it("mergeCalibration/mergeResume/mergeIdentity/mergeTargeting each operate on a raw update value, not a full extracted_updates object", () => {
    expect(mergeCalibration({}, { skills: ["Go"], evidence: [], range_statement: "r", background_summary: "b" }).calibration?.skills).toEqual(["Go"]);
    expect(mergeResume({}, { cv_markdown: "# CV" }).resume?.cv_markdown).toBe("# CV");
    expect(mergeIdentity({}, { name: "A", email: "a@example.com" }).identity?.name).toBe("A");
    expect(mergeTargeting({}, { tiers: [], thesis_summary: "t" }).targeting?.thesis_summary).toBe("t");
  });
});
