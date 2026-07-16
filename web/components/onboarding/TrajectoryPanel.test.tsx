import { describe, expect, it, vi } from "vitest";
import { initialTrajectoryState, submitTrajectory, trajectoryReducer } from "./TrajectoryPanel";

describe("trajectoryReducer", () => {
  it("direction_chosen sets the direction; re-choosing overwrites", () => {
    let state = trajectoryReducer(initialTrajectoryState(), { type: "direction_chosen", direction: "climb" });
    expect(state.direction).toBe("climb");
    state = trajectoryReducer(state, { type: "direction_chosen", direction: "experiment" });
    expect(state.direction).toBe("experiment");
  });

  it("free_text_changed tracks the optional context field", () => {
    const state = trajectoryReducer(initialTrajectoryState(), { type: "free_text_changed", value: "eyeing staff eng" });
    expect(state.freeText).toBe("eyeing staff eng");
  });
});

describe("submitTrajectory", () => {
  it("POSTs direction and free_text when present", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "trajectory", receipt: "trajectory: climb" }) }));
    await submitTrajectory("climb", "eyeing staff eng", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/trajectory",
      expect.objectContaining({ body: JSON.stringify({ direction: "climb", free_text: "eyeing staff eng" }) })
    );
  });

  it("omits free_text entirely when blank", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "trajectory", receipt: "trajectory: switch" }) }));
    await submitTrajectory("switch", "   ", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/trajectory",
      expect.objectContaining({ body: JSON.stringify({ direction: "switch" }) })
    );
  });
});
