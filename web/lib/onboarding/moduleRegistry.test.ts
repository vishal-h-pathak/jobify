import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY, markModuleComplete, phaseOneComplete, type ModuleKey, type ModulesState } from "./moduleRegistry";

const ALL_KEYS: ModuleKey[] = [
  "anchor",
  "reactions",
  "values",
  "dealbreakers",
  "range",
  "energy",
  "environment",
  "trajectory",
  "evidence",
  "voice",
  "metrics",
  "mirror",
];

const PHASES: Record<ModuleKey, 1 | 2 | 3> = {
  anchor: 1,
  reactions: 1,
  values: 1,
  dealbreakers: 1,
  range: 2,
  energy: 2,
  environment: 2,
  trajectory: 2,
  evidence: 2,
  voice: 2,
  metrics: 2,
  mirror: 3,
};

describe("MODULE_REGISTRY", () => {
  it("has all twelve keys with the pinned phase assignments", () => {
    expect(Object.keys(MODULE_REGISTRY).sort()).toEqual([...ALL_KEYS].sort());
    for (const key of ALL_KEYS) {
      expect(MODULE_REGISTRY[key].key).toBe(key);
      expect(MODULE_REGISTRY[key].phase).toBe(PHASES[key]);
    }
  });

  describe("receipts", () => {
    it("anchor: title + company, title alone, free_text alone, or null", () => {
      const { receipt } = MODULE_REGISTRY.anchor;
      expect(receipt({ current_title: "Engineer", current_company: "Acme" })).toBe("Engineer · Acme");
      expect(receipt({ current_title: "Engineer" })).toBe("Engineer");
      expect(receipt({ free_text: "Between roles" })).toBe("Between roles");
      expect(receipt({})).toBeNull();
    });

    it("reactions: counts total + interested, or null when empty", () => {
      const { receipt } = MODULE_REGISTRY.reactions;
      expect(
        receipt({
          reactions: [{ reaction: "interested" }, { reaction: "not_interested" }, { reaction: "interested" }],
        })
      ).toBe("3 reactions (2 interested)");
      expect(receipt({ reactions: [] })).toBeNull();
      expect(receipt({})).toBeNull();
    });

    it("values: counts trade-offs answered, or null when empty", () => {
      const { receipt } = MODULE_REGISTRY.values;
      expect(receipt({ choices: [{ prompt: "a", chosen: "b" }] })).toBe("1 trade-off answered");
      expect(receipt({ choices: [{ prompt: "a", chosen: "b" }, { prompt: "c", chosen: "d" }] })).toBe(
        "2 trade-offs answered"
      );
      expect(receipt({})).toBeNull();
    });

    it("dealbreakers: counts hard constraints, distinguishing zero from none", () => {
      const { receipt } = MODULE_REGISTRY.dealbreakers;
      expect(receipt({ hard_disqualifiers: ["Crypto"] })).toBe("1 hard constraint");
      expect(receipt({ hard_disqualifiers: ["Crypto", "Defense"] })).toBe("2 hard constraints");
      expect(receipt({ hard_disqualifiers: [] })).toBe("no hard constraints");
      expect(receipt({})).toBe("no hard constraints");
    });

    it("energy/environment/trajectory: real receipts (31 builds their extractors this wave)", () => {
      expect(MODULE_REGISTRY.energy.receipt({ hours_disappear: "debugging" })).toBe("debugging");
      expect(MODULE_REGISTRY.energy.receipt({})).toBeNull();
      expect(MODULE_REGISTRY.environment.receipt({ choices: [{ scenario: "pace", chosen: "fast" }] })).toBe(
        "1 environment preference"
      );
      expect(MODULE_REGISTRY.environment.receipt({})).toBeNull();
      expect(MODULE_REGISTRY.trajectory.receipt({ direction: "climb" })).toBe("climb");
      expect(MODULE_REGISTRY.trajectory.receipt({})).toBeNull();
    });

    it("range/evidence/voice/metrics/mirror return null — no extractor exists yet", () => {
      for (const key of ["range", "evidence", "voice", "metrics", "mirror"] as ModuleKey[]) {
        expect(MODULE_REGISTRY[key].receipt({ anything: "goes" })).toBeNull();
      }
    });
  });
});

describe("markModuleComplete", () => {
  it("marks the given key complete with an ISO timestamp + the receipt", () => {
    const before = Date.now();
    const modules = markModuleComplete({ modules: {} }, "anchor", "Engineer · Acme");
    const after = Date.now();
    expect(modules.anchor?.receipt).toBe("Engineer · Acme");
    const completedAt = new Date(modules.anchor!.completed_at).getTime();
    expect(completedAt).toBeGreaterThanOrEqual(before);
    expect(completedAt).toBeLessThanOrEqual(after);
  });

  it("leaves every other module's completion (and checkpoint_hunt) untouched", () => {
    const existing: ModulesState = {
      anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "Engineer · Acme" },
      checkpoint_hunt: { fired_at: "2026-01-02T00:00:00.000Z" },
    };
    const modules = markModuleComplete({ modules: existing }, "values", "2 trade-offs answered");
    expect(modules.anchor).toEqual(existing.anchor);
    expect(modules.checkpoint_hunt).toEqual(existing.checkpoint_hunt);
    expect(modules.values?.receipt).toBe("2 trade-offs answered");
  });

  it("is idempotent: calling it twice for the same key overwrites in place, never duplicates", () => {
    let modules = markModuleComplete({ modules: {} }, "dealbreakers", "no hard constraints");
    modules = markModuleComplete({ modules }, "dealbreakers", "no hard constraints");
    expect(Object.keys(modules)).toEqual(["dealbreakers"]);
    expect(modules.dealbreakers?.receipt).toBe("no hard constraints");
  });
});

describe("phaseOneComplete", () => {
  const complete = (over: Partial<ModulesState> = {}): ModulesState => ({
    anchor: { completed_at: "t", receipt: "r" },
    reactions: { completed_at: "t", receipt: "r" },
    values: { completed_at: "t", receipt: "r" },
    dealbreakers: { completed_at: "t", receipt: "r" },
    ...over,
  });

  it("is false when any of the four phase-1 keys is missing", () => {
    for (const key of ["anchor", "reactions", "values", "dealbreakers"] as ModuleKey[]) {
      const modules = complete();
      delete modules[key];
      expect(phaseOneComplete(modules)).toBe(false);
    }
  });

  it("is false for an empty modules state", () => {
    expect(phaseOneComplete({})).toBe(false);
  });

  it("is true once anchor + reactions + values + dealbreakers are all complete", () => {
    expect(phaseOneComplete(complete())).toBe(true);
  });

  it("ignores phase-2/3 completion and checkpoint_hunt when deciding", () => {
    expect(
      phaseOneComplete(
        complete({
          checkpoint_hunt: { fired_at: "t" },
          mirror: { completed_at: "t", receipt: "r" },
        })
      )
    ).toBe(true);
  });
});
