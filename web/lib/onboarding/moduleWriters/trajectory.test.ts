import { describe, expect, it } from "vitest";
import { applyTrajectoryToDoc, parseTrajectoryBody, trajectoryReceipt } from "./trajectory";

describe("parseTrajectoryBody", () => {
  it("rejects a missing direction", () => {
    expect(parseTrajectoryBody({}).ok).toBe(false);
  });

  it("rejects an invalid direction", () => {
    expect(parseTrajectoryBody({ direction: "coast" }).ok).toBe(false);
  });

  it("accepts a bare direction with no free_text", () => {
    const result = parseTrajectoryBody({ direction: "climb" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ direction: "climb" });
  });

  it("accepts direction + trimmed free_text", () => {
    const result = parseTrajectoryBody({ direction: "switch", free_text: " into infra " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ direction: "switch", free_text: "into infra" });
  });
});

describe("trajectoryReceipt", () => {
  it("includes the chosen direction", () => {
    expect(trajectoryReceipt({ direction: "experiment" })).toBe("trajectory: experiment");
  });
});

describe("applyTrajectoryToDoc", () => {
  it("is pure: does not mutate the input doc", () => {
    const doc = { "thesis.md": "" };
    const before = { ...doc };
    applyTrajectoryToDoc(doc, { direction: "climb" });
    expect(doc).toEqual(before);
  });

  it("renders direction + tier hint into thesis.md", () => {
    const result = applyTrajectoryToDoc({ "thesis.md": "" }, { direction: "climb" });
    expect(result["thesis.md"]).toContain("## Trajectory");
    expect(result["thesis.md"]).toContain("Direction: climb");
    expect(result["thesis.md"]).toContain("senior/staff-tier");
  });

  it("includes free_text verbatim when provided", () => {
    const result = applyTrajectoryToDoc({ "thesis.md": "" }, { direction: "switch", free_text: "into infra" });
    expect(result["thesis.md"]).toContain("into infra");
  });

  it("re-submission replaces the section instead of duplicating it", () => {
    let doc: Record<string, string> = { "thesis.md": "" };
    doc = applyTrajectoryToDoc(doc, { direction: "climb" });
    doc = applyTrajectoryToDoc(doc, { direction: "stabilize" });
    expect(doc["thesis.md"].match(/## Trajectory/g)).toHaveLength(1);
    expect(doc["thesis.md"]).toContain("Direction: stabilize");
    expect(doc["thesis.md"]).not.toContain("Direction: climb");
  });
});
