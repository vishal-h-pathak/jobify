import { describe, expect, it } from "vitest";
import { applyValuesToDoc, parseValuesBody, valuesReceipt, VALUE_PAIRS } from "./values";

const ALL_A = VALUE_PAIRS.map((pair) => ({ pair_id: pair.pair_id, choice: "a" as const }));

describe("parseValuesBody", () => {
  it("rejects a non-array body", () => {
    const result = parseValuesBody({ pair_id: "mission_prestige", choice: "a" });
    expect(result.ok).toBe(false);
  });

  it("rejects fewer than 6 choices", () => {
    const result = parseValuesBody(ALL_A.slice(0, 5));
    expect(result.ok).toBe(false);
  });

  it("rejects more than 7 choices", () => {
    const result = parseValuesBody([...ALL_A, { pair_id: "mission_prestige", choice: "b" }]);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown pair_id", () => {
    const body = [...ALL_A.slice(0, 5), { pair_id: "not_real", choice: "a" }];
    const result = parseValuesBody(body);
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate pair_id", () => {
    const body = [ALL_A[0], ALL_A[0], ...ALL_A.slice(1, 5)];
    const result = parseValuesBody(body);
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid choice value", () => {
    const body = ALL_A.slice(0, 5).concat([{ pair_id: VALUE_PAIRS[5].pair_id, choice: "c" as unknown as "a" }]);
    const result = parseValuesBody(body);
    expect(result.ok).toBe(false);
  });

  it("accepts exactly 6 valid choices", () => {
    const result = parseValuesBody(ALL_A.slice(0, 6));
    expect(result.ok).toBe(true);
  });

  it("accepts all 7 valid choices", () => {
    const result = parseValuesBody(ALL_A);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(7);
  });
});

describe("valuesReceipt", () => {
  it("reports the count chosen", () => {
    expect(valuesReceipt(ALL_A.slice(0, 6))).toBe("6 trade-offs chosen");
  });
});

describe("applyValuesToDoc", () => {
  it("is pure: does not mutate the input doc", () => {
    const doc = { "thesis.md": "# Hunting thesis\n" };
    const before = { ...doc };
    applyValuesToDoc(doc, ALL_A.slice(0, 6));
    expect(doc).toEqual(before);
  });

  it("renders the chosen-side label for each pair into thesis.md", () => {
    const doc = { "thesis.md": "" };
    const result = applyValuesToDoc(doc, [{ pair_id: "mission_prestige", choice: "a" }]);
    expect(result["thesis.md"]).toContain("## What matters (chosen under trade-off)");
    expect(result["thesis.md"]).toContain("- Mission-driven work");
    expect(result["thesis.md"]).not.toContain("Prestige / brand name");
  });

  it("re-submission replaces the section instead of duplicating it", () => {
    let doc: Record<string, string> = { "thesis.md": "" };
    doc = applyValuesToDoc(doc, [{ pair_id: "mission_prestige", choice: "a" }]);
    doc = applyValuesToDoc(doc, [{ pair_id: "mission_prestige", choice: "b" }]);
    expect(doc["thesis.md"].match(/## What matters/g)).toHaveLength(1);
    expect(doc["thesis.md"]).toContain("Prestige / brand name");
    expect(doc["thesis.md"]).not.toContain("Mission-driven work");
  });

  it("leaves other doc files untouched", () => {
    const doc = { "thesis.md": "", "disqualifiers.yml": "hard_disqualifiers: []\n" };
    const result = applyValuesToDoc(doc, [{ pair_id: "mission_prestige", choice: "a" }]);
    expect(result["disqualifiers.yml"]).toBe("hard_disqualifiers: []\n");
  });
});
