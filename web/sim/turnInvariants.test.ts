import { describe, expect, it } from "vitest";
import { checkProgressInvariant, checkNoDoubleFallbackInvariant, checkLedgerInvariant, type TurnRecord } from "./turnInvariants";

function record(overrides: Partial<TurnRecord> & Pick<TurnRecord, "turnIndex">): TurnRecord {
  return {
    stageBefore: "targeting",
    stageAfter: "targeting",
    assistantText: "some question?",
    done: false,
    extractedAfter: {},
    ...overrides,
  };
}

describe("checkProgressInvariant", () => {
  it("passes a clean run that reaches done with each stage landing promptly", () => {
    const records: TurnRecord[] = [
      record({ turnIndex: 1, stageBefore: "calibration", stageAfter: "resume", extractedAfter: { calibration: { skills: ["Go"] } } }),
      record({ turnIndex: 2, stageBefore: "resume", stageAfter: "targeting", extractedAfter: { calibration: { skills: ["Go"] } } }),
      record({
        turnIndex: 3,
        stageBefore: "targeting",
        stageAfter: "targeting",
        extractedAfter: { identity: { name: "Alex Quinn" } },
      }),
      record({ turnIndex: 4, stageBefore: "targeting", stageAfter: "done", done: true, extractedAfter: { identity: { name: "Alex Quinn" } } }),
    ];
    const result = checkProgressInvariant(records, 25);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("FAILS when stage regresses", () => {
    const records: TurnRecord[] = [
      record({ turnIndex: 1, stageBefore: "targeting", stageAfter: "targeting" }),
      record({ turnIndex: 2, stageBefore: "targeting", stageAfter: "resume" }),
    ];
    const result = checkProgressInvariant(records, 25);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("regress"))).toBe(true);
  });

  it("FAILS when calibration lingers more than 4 turns without record_calibration landing", () => {
    const records: TurnRecord[] = Array.from({ length: 5 }, (_, i) =>
      record({ turnIndex: i + 1, stageBefore: "calibration", stageAfter: "calibration", extractedAfter: {} })
    );
    const result = checkProgressInvariant(records, 25);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("calibration"))).toBe(true);
  });

  it("FAILS when targeting lingers more than 4 turns without record_identity landing", () => {
    const records: TurnRecord[] = Array.from({ length: 5 }, (_, i) =>
      record({ turnIndex: i + 1, stageBefore: "targeting", stageAfter: "targeting", extractedAfter: {} })
    );
    const result = checkProgressInvariant(records, 25);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("targeting"))).toBe(true);
  });

  it("passes when identity lands on turn 4 of targeting (within the 4-turn budget)", () => {
    const records: TurnRecord[] = [
      record({ turnIndex: 1, stageBefore: "targeting", stageAfter: "targeting", extractedAfter: {} }),
      record({ turnIndex: 2, stageBefore: "targeting", stageAfter: "targeting", extractedAfter: {} }),
      record({ turnIndex: 3, stageBefore: "targeting", stageAfter: "targeting", extractedAfter: {} }),
      record({
        turnIndex: 4,
        stageBefore: "targeting",
        stageAfter: "done",
        done: true,
        extractedAfter: { identity: { name: "Alex Quinn" } },
      }),
    ];
    const result = checkProgressInvariant(records, 25);
    expect(result.passed).toBe(true);
  });

  it("FAILS when the run never reaches done", () => {
    const records: TurnRecord[] = [record({ turnIndex: 1, done: false })];
    const result = checkProgressInvariant(records, 25);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("done"))).toBe(true);
  });
});

describe("checkNoDoubleFallbackInvariant", () => {
  it("passes when no fallback ever fires", () => {
    const records: TurnRecord[] = [record({ turnIndex: 1 }), record({ turnIndex: 2 })];
    expect(checkNoDoubleFallbackInvariant(records).passed).toBe(true);
  });

  it("passes when fallback kinds alternate", () => {
    const records: TurnRecord[] = [
      record({ turnIndex: 1, fallbackKind: "no_progress" }),
      record({ turnIndex: 2, fallbackKind: "retry_exhausted" }),
    ];
    expect(checkNoDoubleFallbackInvariant(records).passed).toBe(true);
  });

  it("FAILS when the same fallback kind fires on two consecutive turns", () => {
    const records: TurnRecord[] = [
      record({ turnIndex: 1, fallbackKind: "retry_exhausted" }),
      record({ turnIndex: 2, fallbackKind: "retry_exhausted" }),
    ];
    const result = checkNoDoubleFallbackInvariant(records);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("retry_exhausted");
  });

  it("passes when the same fallback kind repeats but with a normal turn in between", () => {
    const records: TurnRecord[] = [
      record({ turnIndex: 1, fallbackKind: "retry_exhausted" }),
      record({ turnIndex: 2 }),
      record({ turnIndex: 3, fallbackKind: "retry_exhausted" }),
    ];
    expect(checkNoDoubleFallbackInvariant(records).passed).toBe(true);
  });
});

describe("checkLedgerInvariant", () => {
  it("passes when ledger row count exactly equals real model call count", () => {
    expect(checkLedgerInvariant(5, 5).passed).toBe(true);
  });

  it("FAILS when they differ, with counts in the message", () => {
    const result = checkLedgerInvariant(4, 5);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toMatch(/4/);
    expect(result.failures[0]).toMatch(/5/);
  });
});
