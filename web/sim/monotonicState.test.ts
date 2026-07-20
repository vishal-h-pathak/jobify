import { describe, expect, it } from "vitest";
import { checkMonotonicState, checkMonotonicStateAcrossTurns } from "./monotonicState";

describe("checkMonotonicState", () => {
  it("passes when nothing changes", () => {
    const state = { identity: { name: "Alex Quinn", email: "alex.quinn@example.com" } };
    const result = checkMonotonicState(state, state);
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("passes when a brand-new field is added", () => {
    const before = { identity: { name: "Alex Quinn" } };
    const after = { identity: { name: "Alex Quinn" }, targeting: { tiers: [{ key: "tier_1", label: "x" }] } };
    expect(checkMonotonicState(before, after).passed).toBe(true);
  });

  it("passes when an existing non-empty field is corrected to a different non-empty value", () => {
    const before = { identity: { location_base: "Denver, CO" } };
    const after = { identity: { location_base: "Boulder, CO" } };
    expect(checkMonotonicState(before, after).passed).toBe(true);
  });

  it("passes on an empty -> non-empty transition", () => {
    const before = { identity: { phone: undefined } };
    const after = { identity: { phone: "+1-555-0142" } };
    expect(checkMonotonicState(before, after).passed).toBe(true);
  });

  it("FAILS when a top-level field disappears entirely", () => {
    const before = { identity: { name: "Alex Quinn" } };
    const after = {};
    const result = checkMonotonicState(before, after);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ path: "identity", before: { name: "Alex Quinn" } })
    );
  });

  it("FAILS when a nested field is wiped — the live bug: identity present, location_and_compensation destroyed", () => {
    const before = {
      identity: {
        name: "Alex Quinn",
        location_and_compensation: { base: "Denver, CO", remote_acceptable: true, target_comp_usd: "175000-205000" },
      },
    };
    const after = { identity: { name: "Alex Quinn" } };

    const result = checkMonotonicState(before, after);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ path: "identity.location_and_compensation" })
    );
  });

  it("FAILS when an array shrinks", () => {
    const before = { targeting: { hard_disqualifiers: ["no crypto", "no unpaid on-call"] } };
    const after = { targeting: { hard_disqualifiers: ["no crypto"] } };
    const result = checkMonotonicState(before, after);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ path: "targeting.hard_disqualifiers" })
    );
  });

  it("passes when an array grows", () => {
    const before = { targeting: { hard_disqualifiers: ["no crypto"] } };
    const after = { targeting: { hard_disqualifiers: ["no crypto", "no unpaid on-call"] } };
    expect(checkMonotonicState(before, after).passed).toBe(true);
  });

  it("FAILS when a string field is blanked out", () => {
    const before = { identity: { email: "alex.quinn@example.com" } };
    const after = { identity: { email: "" } };
    const result = checkMonotonicState(before, after);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({ path: "identity.email" }));
  });
});

describe("checkMonotonicStateAcrossTurns", () => {
  it("passes a monotonically-growing sequence of extracted snapshots", () => {
    const snapshots = [
      {},
      { anchor: { current_title: "Staff Engineer" } },
      { anchor: { current_title: "Staff Engineer" }, calibration: { skills: ["Go"] } },
      {
        anchor: { current_title: "Staff Engineer" },
        calibration: { skills: ["Go"] },
        identity: { name: "Alex Quinn", location_and_compensation: { base: "Denver, CO" } },
      },
    ];
    const result = checkMonotonicStateAcrossTurns(snapshots);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("FAILS and reports the turn index where a field first disappears", () => {
    const snapshots = [
      { identity: { name: "Alex Quinn", location_and_compensation: { base: "Denver, CO" } } },
      { identity: { name: "Alex Quinn" } }, // turn 1: location_and_compensation wiped
    ];
    const result = checkMonotonicStateAcrossTurns(snapshots);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ turnIndex: 1 });
    expect(result.failures[0]!.violations).toContainEqual(
      expect.objectContaining({ path: "identity.location_and_compensation" })
    );
  });
});
