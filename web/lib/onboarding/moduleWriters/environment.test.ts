import { describe, expect, it } from "vitest";
import { applyEnvironmentToDoc, environmentReceipt, parseEnvironmentBody } from "./environment";

const VALID = { team_size: "a", pace: "b", ambiguity: "a", management_appetite: "b" } as const;

describe("parseEnvironmentBody", () => {
  it("rejects a non-object body", () => {
    expect(parseEnvironmentBody(null).ok).toBe(false);
    expect(parseEnvironmentBody("nope").ok).toBe(false);
  });

  it("rejects a missing scenario key", () => {
    const { management_appetite: _drop, ...partial } = VALID;
    expect(parseEnvironmentBody(partial).ok).toBe(false);
  });

  it("rejects an invalid choice value", () => {
    expect(parseEnvironmentBody({ ...VALID, pace: "c" }).ok).toBe(false);
  });

  it("accepts all four valid picks", () => {
    const result = parseEnvironmentBody(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(VALID);
  });
});

describe("environmentReceipt", () => {
  it("reports 4 scenarios chosen", () => {
    expect(environmentReceipt()).toBe("4 scenarios chosen");
  });
});

describe("applyEnvironmentToDoc", () => {
  it("is pure: does not mutate the input doc", () => {
    const doc = { "thesis.md": "" };
    const before = { ...doc };
    applyEnvironmentToDoc(doc, VALID);
    expect(doc).toEqual(before);
  });

  it("renders the chosen-side label for each scenario", () => {
    const result = applyEnvironmentToDoc({ "thesis.md": "" }, VALID);
    expect(result["thesis.md"]).toContain("## Environment preferences");
    expect(result["thesis.md"]).toContain("Small team (fewer than 10)");
    expect(result["thesis.md"]).toContain("Deliberate, high-review");
    expect(result["thesis.md"]).not.toContain("Large team or org");
  });

  it("re-submission replaces the section instead of duplicating it", () => {
    let doc: Record<string, string> = { "thesis.md": "" };
    doc = applyEnvironmentToDoc(doc, VALID);
    doc = applyEnvironmentToDoc(doc, { team_size: "b", pace: "a", ambiguity: "b", management_appetite: "a" });
    expect(doc["thesis.md"].match(/## Environment preferences/g)).toHaveLength(1);
    expect(doc["thesis.md"]).toContain("Large team or org (10+)");
  });
});
