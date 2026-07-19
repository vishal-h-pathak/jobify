import { describe, expect, it } from "vitest";
import { formatVerdictTable, type PersonaVerdict } from "./report";

function verdict(overrides: Partial<PersonaVerdict> & Pick<PersonaVerdict, "persona">): PersonaVerdict {
  return {
    turns: 8,
    passed: true,
    failureSummary: [],
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.0105,
    ...overrides,
  };
}

describe("formatVerdictTable", () => {
  it("includes every persona name and its PASS/FAIL verdict", () => {
    const table = formatVerdictTable([
      verdict({ persona: "cooperative", passed: true }),
      verdict({ persona: "terse", passed: false, failureSummary: ["NO-REPEAT: turn 4 repeats turn 2"] }),
    ]);
    expect(table).toContain("cooperative");
    expect(table).toContain("terse");
    expect(table).toMatch(/cooperative[\s\S]*PASS/);
    expect(table).toMatch(/terse[\s\S]*FAIL/);
  });

  it("prints a grand total of tokens and cost across all personas", () => {
    const table = formatVerdictTable([
      verdict({ persona: "cooperative", inputTokens: 1000, outputTokens: 500, costUsd: 0.0105 }),
      verdict({ persona: "terse", inputTokens: 500, outputTokens: 200, costUsd: 0.0045 }),
    ]);
    expect(table).toMatch(/1500/); // total input tokens
    expect(table).toMatch(/700/); // total output tokens
    expect(table).toContain("0.015"); // total cost, ~0.0150
  });

  it("lists failure detail lines only for failing personas", () => {
    const table = formatVerdictTable([
      verdict({ persona: "cooperative", passed: true }),
      verdict({ persona: "corrective", passed: false, failureSummary: ["MONOTONIC-STATE: identity.location_and_compensation disappeared at turn 3"] }),
    ]);
    expect(table).toContain("MONOTONIC-STATE: identity.location_and_compensation disappeared at turn 3");
    const cooperativeFailureIndex = table.indexOf("cooperative:");
    expect(cooperativeFailureIndex).toBe(-1);
  });

  it("omits the failures section entirely when every persona passes", () => {
    const table = formatVerdictTable([verdict({ persona: "cooperative" }), verdict({ persona: "terse" })]);
    expect(table.toUpperCase()).not.toContain("FAILURES");
  });
});
