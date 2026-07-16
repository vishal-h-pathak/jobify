import { describe, expect, it, vi } from "vitest";
import {
  buildHardDisqualifiers,
  dealbreakersReducer,
  initialDealbreakersState,
  submitDealbreakers,
  type DealbreakersState,
} from "./DealbreakersPanel";

describe("dealbreakersReducer", () => {
  it("simple_toggled toggles a chip on then off", () => {
    let state = dealbreakersReducer(initialDealbreakersState(), { type: "simple_toggled", id: "defense" });
    expect(state.activeSimple).toEqual(["defense"]);
    state = dealbreakersReducer(state, { type: "simple_toggled", id: "defense" });
    expect(state.activeSimple).toEqual([]);
  });

  it("comp_toggled clears compValue when turning off", () => {
    let state = dealbreakersReducer(initialDealbreakersState(), { type: "comp_toggled" });
    state = dealbreakersReducer(state, { type: "comp_value_changed", value: "120000" });
    expect(state.compValue).toBe("120000");
    state = dealbreakersReducer(state, { type: "comp_toggled" });
    expect(state.compActive).toBe(false);
    expect(state.compValue).toBe("");
  });

  it("free_add_committed trims, dedupes, and clears the draft", () => {
    let state = dealbreakersReducer(initialDealbreakersState(), { type: "free_add_draft_changed", value: "  no travel  " });
    state = dealbreakersReducer(state, { type: "free_add_committed" });
    expect(state.freeAdd).toEqual(["no travel"]);
    expect(state.freeAddDraft).toBe("");

    state = dealbreakersReducer(state, { type: "free_add_draft_changed", value: "no travel" });
    state = dealbreakersReducer(state, { type: "free_add_committed" });
    expect(state.freeAdd).toEqual(["no travel"]); // no dupe
  });

  it("free_add_committed with an empty/whitespace draft is a no-op besides clearing", () => {
    let state = dealbreakersReducer(initialDealbreakersState(), { type: "free_add_draft_changed", value: "   " });
    state = dealbreakersReducer(state, { type: "free_add_committed" });
    expect(state.freeAdd).toEqual([]);
  });

  it("free_add_removed removes exactly that value", () => {
    let state: DealbreakersState = { ...initialDealbreakersState(), freeAdd: ["no travel", "no on-call"] };
    state = dealbreakersReducer(state, { type: "free_add_removed", value: "no travel" });
    expect(state.freeAdd).toEqual(["no on-call"]);
  });

  it("soft_concern_committed mirrors free_add's trim/dedupe behavior", () => {
    let state = dealbreakersReducer(initialDealbreakersState(), { type: "soft_concern_draft_changed", value: "long commute" });
    state = dealbreakersReducer(state, { type: "soft_concern_committed" });
    expect(state.softConcerns).toEqual(["long commute"]);
  });

  it("submit_failed returns to editing without losing entered state", () => {
    const state = dealbreakersReducer(
      { ...initialDealbreakersState(), phase: "submitting", activeSimple: ["defense"] },
      { type: "submit_failed", error: "network down" }
    );
    expect(state.phase).toBe("editing");
    expect(state.error).toBe("network down");
    expect(state.activeSimple).toEqual(["defense"]);
  });
});

describe("buildHardDisqualifiers", () => {
  it("combines simple chips, comp, city, and free-add into one array", () => {
    const state: DealbreakersState = {
      ...initialDealbreakersState(),
      activeSimple: ["defense", "onsite_required"],
      compActive: true,
      compValue: "120000",
      cityActive: true,
      cityValue: "Atlanta",
      freeAdd: ["no travel"],
    };
    expect(buildHardDisqualifiers(state)).toEqual([
      "on-site required",
      "defense",
      "comp below $120000",
      "only Atlanta",
      "no travel",
    ]);
  });

  it("comp/city chips active but empty values contribute nothing", () => {
    const state: DealbreakersState = { ...initialDealbreakersState(), compActive: true, compValue: "  ", cityActive: true, cityValue: "" };
    expect(buildHardDisqualifiers(state)).toEqual([]);
  });

  it("no selections at all -> empty array (submit stays disabled)", () => {
    expect(buildHardDisqualifiers(initialDealbreakersState())).toEqual([]);
  });
});

describe("submitDealbreakers", () => {
  it("POSTs hard_disqualifiers and soft_concerns", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "dealbreakers", receipt: "2 dealbreakers" }) }));
    await submitDealbreakers(["defense"], ["long commute"], fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/dealbreakers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ hard_disqualifiers: ["defense"], soft_concerns: ["long commute"] }),
      })
    );
  });
});
