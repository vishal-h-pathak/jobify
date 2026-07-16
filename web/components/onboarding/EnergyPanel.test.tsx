import { describe, expect, it, vi } from "vitest";
import { energyFormValid, energyReducer, initialEnergyState, submitEnergy } from "./EnergyPanel";

describe("energyReducer", () => {
  it("tracks both fields independently", () => {
    let state = energyReducer(initialEnergyState(), { type: "hours_disappear_changed", value: "debugging the flaky test" });
    state = energyReducer(state, { type: "kept_putting_off_changed", value: "writing docs" });
    expect(state.hoursDisappear).toBe("debugging the flaky test");
    expect(state.keptPuttingOff).toBe("writing docs");
  });

  it("submit_failed returns to editing without clearing the draft", () => {
    let state = energyReducer(initialEnergyState(), { type: "hours_disappear_changed", value: "x" });
    state = energyReducer(state, { type: "submit_started" });
    state = energyReducer(state, { type: "submit_failed", error: "network down" });
    expect(state.phase).toBe("editing");
    expect(state.hoursDisappear).toBe("x");
    expect(state.error).toBe("network down");
  });
});

describe("energyFormValid", () => {
  it("requires both fields non-empty after trimming", () => {
    expect(energyFormValid(initialEnergyState())).toBe(false);
    expect(energyFormValid({ ...initialEnergyState(), hoursDisappear: "x", keptPuttingOff: "   " })).toBe(false);
    expect(energyFormValid({ ...initialEnergyState(), hoursDisappear: "x", keptPuttingOff: "y" })).toBe(true);
  });
});

describe("submitEnergy", () => {
  it("POSTs trimmed hours_disappear/kept_putting_off", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "energy", receipt: "2 energy signals" }) }));
    await submitEnergy("  x  ", "  y  ", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/energy",
      expect.objectContaining({ body: JSON.stringify({ hours_disappear: "x", kept_putting_off: "y" }) })
    );
  });
});
