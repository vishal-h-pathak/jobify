import { describe, expect, it } from "vitest";
import { seedInitialSession } from "./seedZeroLlmModules";
import { phaseOneComplete } from "../lib/onboarding/moduleRegistry";
import { ALEX_QUINN_ANCHOR } from "./personas/data";

describe("seedInitialSession", () => {
  it("starts the chat sim at the calibration stage with empty messages", () => {
    const session = seedInitialSession("user-1");
    expect(session.stage).toBe("calibration");
    expect(session.messages).toEqual([]);
    expect(session.status).toBe("in_progress");
  });

  it("writes extracted.anchor directly, matching the anchor form's zero-LLM contract", () => {
    const session = seedInitialSession("user-1");
    expect(session.extracted.anchor).toEqual(ALEX_QUINN_ANCHOR);
  });

  it("marks every zero-LLM module complete (anchor, values, dealbreakers, energy, environment, trajectory, reactions)", () => {
    const session = seedInitialSession("user-1");
    for (const key of ["anchor", "values", "dealbreakers", "energy", "environment", "trajectory", "reactions"] as const) {
      const entry = session.modules[key];
      expect(entry, `expected modules.${key} to be marked complete`).toBeDefined();
      expect(entry && "receipt" in entry ? entry.receipt.length : 0).toBeGreaterThan(0);
      expect(entry && "completed_at" in entry ? entry.completed_at : "").not.toBe("");
    }
  });

  it("never fires the checkpoint marker — that's the live app's background-hunt side effect, out of the sim's scope", () => {
    const session = seedInitialSession("user-1");
    expect(session.modules.checkpoint_hunt).toBeUndefined();
  });

  it("phase 1 (anchor + reactions + values + dealbreakers) reads as complete via the real moduleRegistry check", () => {
    const session = seedInitialSession("user-1");
    expect(phaseOneComplete(session.modules)).toBe(true);
  });

  it("reactions reach the real completion threshold (6)", () => {
    const session = seedInitialSession("user-1");
    const reactions = (session.extracted as unknown as Record<string, unknown[]>).reactions;
    expect(reactions.length).toBeGreaterThanOrEqual(6);
  });

  it("is stable across calls — same anchor/module-key content, independent of the completed_at wall-clock timestamp", () => {
    const a = seedInitialSession("user-1");
    const b = seedInitialSession("user-2");
    expect(a.extracted.anchor).toEqual(b.extracted.anchor);
    expect(Object.keys(a.modules).sort()).toEqual(Object.keys(b.modules).sort());
  });
});
