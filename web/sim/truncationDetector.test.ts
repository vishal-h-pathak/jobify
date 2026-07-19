import { describe, expect, it } from "vitest";
import { checkTruncationInvariant, type TruncationEvent } from "./truncationDetector";

describe("checkTruncationInvariant", () => {
  it("passes when no call ever hit its max_tokens cap", () => {
    const result = checkTruncationInvariant([]);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("FAILS when a real call's output_tokens exactly equals its max_tokens cap", () => {
    const events: TruncationEvent[] = [{ turnIndex: 3, outputTokens: 1536, maxTokens: 1536 }];
    const result = checkTruncationInvariant(events);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toMatch(/turn 3/);
    expect(result.failures[0]).toMatch(/1536/);
  });

  it("reports every truncated call, not just the first", () => {
    const events: TruncationEvent[] = [
      { turnIndex: 1, outputTokens: 1024, maxTokens: 1024 },
      { turnIndex: 5, outputTokens: 1536, maxTokens: 1536 },
    ];
    const result = checkTruncationInvariant(events);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(2);
  });

  it("does not flag output well under the cap", () => {
    const events: TruncationEvent[] = [{ turnIndex: 2, outputTokens: 400, maxTokens: 1536 }];
    expect(checkTruncationInvariant(events).passed).toBe(true);
  });
});
