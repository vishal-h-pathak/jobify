import { describe, expect, it } from "vitest";
import { toIncrementalDocExtracted } from "./incrementalDocShape";
import { VALUE_PAIRS } from "./values";
import { ENVIRONMENT_SCENARIOS } from "./environment";

describe("toIncrementalDocExtracted", () => {
  it("values: converts {pair_id, choice}[] into {choices: {prompt, chosen, other}[]}", () => {
    const result = toIncrementalDocExtracted("values", [{ pair_id: "mission_prestige", choice: "a" }]) as {
      choices: Array<{ prompt: string; chosen: string; other?: string }>;
    };
    expect(result.choices).toEqual([
      { prompt: "Mission-driven work vs. Prestige / brand name", chosen: "Mission-driven work", other: "Prestige / brand name" },
    ]);
  });

  it("values: the opposite choice picks the other label", () => {
    const result = toIncrementalDocExtracted("values", [{ pair_id: "mission_prestige", choice: "b" }]) as {
      choices: Array<{ chosen: string; other?: string }>;
    };
    expect(result.choices[0].chosen).toBe("Prestige / brand name");
    expect(result.choices[0].other).toBe("Mission-driven work");
  });

  it("values: covers every pinned pair_id without falling back to the id itself", () => {
    for (const pair of VALUE_PAIRS) {
      const result = toIncrementalDocExtracted("values", [{ pair_id: pair.pair_id, choice: "a" }]) as {
        choices: Array<{ chosen: string }>;
      };
      expect(result.choices[0].chosen).toBe(pair.a);
    }
  });

  it("environment: converts the fixed-key a/b object into {choices: {scenario, chosen}[]}", () => {
    const result = toIncrementalDocExtracted("environment", {
      team_size: "a",
      pace: "b",
      ambiguity: "a",
      management_appetite: "b",
    }) as { choices: Array<{ scenario: string; chosen: string }> };
    expect(result.choices).toHaveLength(ENVIRONMENT_SCENARIOS.length);
    const teamSize = result.choices.find((c) => c.scenario === "team_size");
    expect(teamSize?.chosen).toBe(ENVIRONMENT_SCENARIOS.find((s) => s.key === "team_size")!.a);
  });

  it("trajectory: renames free_text to note", () => {
    const result = toIncrementalDocExtracted("trajectory", { direction: "climb", free_text: "into staff eng" });
    expect(result).toEqual({ direction: "climb", note: "into staff eng" });
  });

  it("trajectory: note is undefined when free_text is absent", () => {
    const result = toIncrementalDocExtracted("trajectory", { direction: "climb" });
    expect(result).toEqual({ direction: "climb", note: undefined });
  });

  it("energy and dealbreakers pass through unchanged (their shapes already match)", () => {
    const energy = { hours_disappear: "debugging", kept_putting_off: "expenses" };
    expect(toIncrementalDocExtracted("energy", energy)).toBe(energy);

    const dealbreakers = { hard_disqualifiers: ["Crypto"], soft_concerns: [] };
    expect(toIncrementalDocExtracted("dealbreakers", dealbreakers)).toBe(dealbreakers);
  });
});
