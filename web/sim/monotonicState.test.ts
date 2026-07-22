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

  describe("Fix E (session 58): ownership-aware array-shrink refinement", () => {
    it("an owning-intent shrink (targetIntent matches the field's root key) is invariant-clean", () => {
      const before = { targeting: { hard_disqualifiers: ["no crypto", "no unpaid on-call"] } };
      const after = { targeting: { hard_disqualifiers: ["no crypto"] } };
      expect(checkMonotonicState(before, after, "targeting").passed).toBe(true);
    });

    it("the SAME shrink still FAILS when targetIntent names a different intent — an opportunistic touch", () => {
      const before = { targeting: { hard_disqualifiers: ["no crypto", "no unpaid on-call"] } };
      const after = { targeting: { hard_disqualifiers: ["no crypto"] } };
      const result = checkMonotonicState(before, after, "identity");
      expect(result.passed).toBe(false);
      expect(result.violations).toContainEqual(expect.objectContaining({ path: "targeting.hard_disqualifiers" }));
    });

    it("a full wipe to empty is NEVER excused, even when targetIntent matches — the merger never produces this for an owning update either", () => {
      const before = { calibration: { skills: ["Go", "Python"] } };
      const after = { calibration: { skills: [] } };
      const result = checkMonotonicState(before, after, "calibration");
      expect(result.passed).toBe(false);
      expect(result.violations).toContainEqual(expect.objectContaining({ path: "calibration.skills" }));
    });

    it("omitting targetIntent preserves the strict pre-Fix-E default: every shrink is a violation", () => {
      const before = { targeting: { hard_disqualifiers: ["no crypto", "no unpaid on-call"] } };
      const after = { targeting: { hard_disqualifiers: ["no crypto"] } };
      expect(checkMonotonicState(before, after).passed).toBe(false);
    });
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

  describe("Fix E (session 58): targetIntent auto-derived from the snapshots' own turn_log", () => {
    function turnLogEntry(target_intent: string) {
      return {
        intent_keys: [target_intent],
        retry_used: false,
        askhint_fallback_used: false,
        input_tokens: 1,
        output_tokens: 1,
        ts: "2026-01-01T00:00:00.000Z",
        target_intent,
        intent_advanced: false,
      };
    }

    it("an owning-intent shrink passes when the AFTER snapshot's newly-appended turn_log entry names that same intent", () => {
      const snapshots = [
        { targeting: { hard_disqualifiers: ["no crypto", "no unpaid on-call"] }, turn_log: [] },
        {
          targeting: { hard_disqualifiers: ["no crypto"] },
          turn_log: [turnLogEntry("targeting")],
        },
      ];
      expect(checkMonotonicStateAcrossTurns(snapshots).passed).toBe(true);
    });

    it("the SAME shrink still FAILS when the newly-appended entry names a different intent (opportunistic touch)", () => {
      const snapshots = [
        { targeting: { hard_disqualifiers: ["no crypto", "no unpaid on-call"] }, turn_log: [] },
        {
          targeting: { hard_disqualifiers: ["no crypto"] },
          turn_log: [turnLogEntry("identity")],
        },
      ];
      const result = checkMonotonicStateAcrossTurns(snapshots);
      expect(result.passed).toBe(false);
      expect(result.failures[0]!.violations).toContainEqual(expect.objectContaining({ path: "targeting.hard_disqualifiers" }));
    });

    it("a turn that appends NO turn_log entry (e.g. the resume-skip fast path) is treated as no target intent — strict default", () => {
      const priorLog = [turnLogEntry("calibration")];
      const snapshots = [
        { targeting: { hard_disqualifiers: ["no crypto", "no unpaid on-call"] }, turn_log: priorLog },
        // turn_log unchanged (same length) despite the shrink — must not
        // misattribute the PRIOR turn's target_intent to this one.
        { targeting: { hard_disqualifiers: ["no crypto"] }, turn_log: priorLog },
      ];
      expect(checkMonotonicStateAcrossTurns(snapshots).passed).toBe(false);
    });
  });
});
