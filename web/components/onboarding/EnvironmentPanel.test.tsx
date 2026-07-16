import { describe, expect, it, vi } from "vitest";
import {
  environmentFormValid,
  environmentReducer,
  initialEnvironmentState,
  submitEnvironment,
  type EnvironmentScenarioDef,
} from "./EnvironmentPanel";

const SCENARIOS: EnvironmentScenarioDef[] = [
  { key: "team_size", a: "Small team (fewer than 10)", b: "Large team or org (10+)" },
  { key: "pace", a: "Fast, ship-and-iterate", b: "Deliberate, high-review" },
  { key: "ambiguity", a: "Comfortable figuring out ambiguity", b: "Prefers clear specs and defined scope" },
  { key: "management_appetite", a: "Wants to manage people eventually", b: "Wants to stay individual-contributor" },
];

describe("environmentReducer", () => {
  it("records a choice per scenario key, overwriting on re-pick", () => {
    let state = environmentReducer(initialEnvironmentState(), { type: "choice_made", key: "team_size", side: "a" });
    expect(state.choices).toEqual({ team_size: "a" });
    state = environmentReducer(state, { type: "choice_made", key: "team_size", side: "b" });
    expect(state.choices).toEqual({ team_size: "b" });
  });
});

describe("environmentFormValid", () => {
  it("requires all 4 scenarios answered", () => {
    expect(environmentFormValid({}, SCENARIOS)).toBe(false);
    expect(environmentFormValid({ team_size: "a", pace: "b", ambiguity: "a" }, SCENARIOS)).toBe(false);
    expect(
      environmentFormValid({ team_size: "a", pace: "b", ambiguity: "a", management_appetite: "b" }, SCENARIOS)
    ).toBe(true);
  });
});

describe("submitEnvironment", () => {
  it("POSTs the choices object directly", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "environment", receipt: "4 environment preferences" }) }));
    const choices = { team_size: "a", pace: "b", ambiguity: "a", management_appetite: "b" } as const;
    await submitEnvironment(choices, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/environment",
      expect.objectContaining({ body: JSON.stringify(choices) })
    );
  });
});
