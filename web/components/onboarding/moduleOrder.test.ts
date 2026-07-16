import { describe, expect, it } from "vitest";
import type { ModulesState } from "@/lib/onboarding/moduleRegistry";
import {
  CANONICAL_MODULE_ORDER,
  completedModuleCount,
  deriveNextModule,
  derivePhaseSegments,
  isModuleComplete,
  latestReceipt,
} from "./moduleOrder";

function completion(receipt: string, completedAt = "2026-07-16T00:00:00.000Z") {
  return { completed_at: completedAt, receipt };
}

describe("CANONICAL_MODULE_ORDER", () => {
  it("has all 12 module keys, phase 1 first, mirror last", () => {
    expect(CANONICAL_MODULE_ORDER).toHaveLength(12);
    expect(CANONICAL_MODULE_ORDER.slice(0, 4)).toEqual(["anchor", "reactions", "values", "dealbreakers"]);
    expect(CANONICAL_MODULE_ORDER.at(-1)).toBe("mirror");
    // interview block sits after the phase-2 structured modules, before voice/metrics
    expect(CANONICAL_MODULE_ORDER.indexOf("trajectory")).toBeLessThan(CANONICAL_MODULE_ORDER.indexOf("range"));
    expect(CANONICAL_MODULE_ORDER.indexOf("evidence")).toBeLessThan(CANONICAL_MODULE_ORDER.indexOf("voice"));
  });
});

describe("isModuleComplete", () => {
  it("a real modules[key] entry always counts as complete, regardless of stage", () => {
    expect(isModuleComplete("anchor", { anchor: completion("Engineer · Acme") }, "anchor")).toBe(true);
  });

  it("range derives from stage (record_calibration -> stage 'resume') until B2 wires markModuleComplete", () => {
    expect(isModuleComplete("range", {}, "anchor")).toBe(false);
    expect(isModuleComplete("range", {}, "calibration")).toBe(false);
    expect(isModuleComplete("range", {}, "resume")).toBe(true);
    expect(isModuleComplete("range", {}, "targeting")).toBe(true);
    expect(isModuleComplete("range", {}, "done")).toBe(true);
  });

  it("evidence derives from stage (record_resume/skip -> stage 'targeting') until B2 wires markModuleComplete", () => {
    // 'identity' is a legacy stage value v2 code never produces (migration
    // 0010 remaps old rows to 'targeting') — not exercised here.
    expect(isModuleComplete("evidence", {}, "resume")).toBe(false);
    expect(isModuleComplete("evidence", {}, "targeting")).toBe(true);
    expect(isModuleComplete("evidence", {}, "done")).toBe(true);
  });

  it("a real modules.range/evidence entry wins even if stage hasn't caught up (post-B2)", () => {
    expect(isModuleComplete("range", { range: completion("range done") }, "anchor")).toBe(true);
  });

  it("every other module key has no stage fallback — only a real modules[key] entry counts", () => {
    for (const key of ["voice", "metrics", "mirror", "energy", "environment", "trajectory"] as const) {
      expect(isModuleComplete(key, {}, "done")).toBe(false);
    }
  });
});

describe("deriveNextModule", () => {
  it("a brand-new session lands on anchor", () => {
    expect(deriveNextModule({}, "anchor")).toBe("anchor");
  });

  it("phase 1 complete, still in the legacy 'calibration' stage -> next is energy (interview block comes later in canonical order)", () => {
    const modules: ModulesState = {
      anchor: completion("Engineer · Acme"),
      reactions: completion("6 reactions (4 interested)"),
      values: completion("7 trade-offs answered"),
      dealbreakers: completion("2 dealbreakers"),
      checkpoint_hunt: { fired_at: "2026-07-16T00:00:00.000Z" },
    };
    expect(deriveNextModule(modules, "calibration")).toBe("energy");
  });

  it("phase-2 structured modules done, interview block not started -> next is range (interview block panel)", () => {
    const modules: ModulesState = {
      anchor: completion("a"),
      reactions: completion("r"),
      values: completion("v"),
      dealbreakers: completion("d"),
      energy: completion("2 energy signals"),
      environment: completion("4 scenarios chosen"),
      trajectory: completion("trajectory: climb"),
    };
    expect(deriveNextModule(modules, "calibration")).toBe("range");
  });

  it("interview block finished (stage done) but voice/metrics/mirror not yet real -> next is voice", () => {
    const modules: ModulesState = {
      anchor: completion("a"),
      reactions: completion("r"),
      values: completion("v"),
      dealbreakers: completion("d"),
      energy: completion("e"),
      environment: completion("en"),
      trajectory: completion("t"),
    };
    expect(deriveNextModule(modules, "done")).toBe("voice");
  });

  it("all 12 complete -> null", () => {
    const modules = Object.fromEntries(CANONICAL_MODULE_ORDER.map((key) => [key, completion(key)])) as ModulesState;
    expect(deriveNextModule(modules, "done")).toBeNull();
  });
});

describe("completedModuleCount", () => {
  it("counts real + stage-derived completions", () => {
    const modules: ModulesState = {
      anchor: completion("a"),
      reactions: completion("r"),
      values: completion("v"),
      dealbreakers: completion("d"),
    };
    // phase 1 (4) + stage-derived range (resume+) = 5
    expect(completedModuleCount(modules, "resume")).toBe(5);
  });
});

describe("derivePhaseSegments", () => {
  it("returns three segments with correct totals and completion counts", () => {
    const modules: ModulesState = {
      anchor: completion("a"),
      reactions: completion("r"),
      values: completion("v"),
      dealbreakers: completion("d"),
    };
    const segments = derivePhaseSegments(modules, "calibration");
    expect(segments).toEqual([
      { phase: 1, label: "Ground truth", completed: 4, total: 4 },
      { phase: 2, label: "Depth", completed: 0, total: 7 },
      { phase: 3, label: "Mirror", completed: 0, total: 1 },
    ]);
  });

  it("interview block's stage-derived range/evidence count toward the Depth segment", () => {
    const segments = derivePhaseSegments({}, "targeting");
    const depth = segments.find((s) => s.phase === 2)!;
    expect(depth.completed).toBe(2); // range + evidence derived complete at stage 'targeting'
  });
});

describe("latestReceipt", () => {
  it("null when nothing is complete yet", () => {
    expect(latestReceipt({})).toBeNull();
  });

  it("picks the entry with the latest completed_at, not canonical-order position", () => {
    const modules: ModulesState = {
      anchor: completion("Engineer · Acme", "2026-07-16T00:00:00.000Z"),
      dealbreakers: completion("2 dealbreakers", "2026-07-16T00:05:00.000Z"),
      reactions: completion("6 reactions (4 interested)", "2026-07-16T00:02:00.000Z"),
    };
    expect(latestReceipt(modules)).toBe("2 dealbreakers");
  });

  it("a redo of an earlier module becomes the newest receipt again", () => {
    const modules: ModulesState = {
      anchor: completion("Engineer · Acme", "2026-07-16T09:00:00.000Z"), // redone after dealbreakers
      dealbreakers: completion("2 dealbreakers", "2026-07-16T00:05:00.000Z"),
    };
    expect(latestReceipt(modules)).toBe("Engineer · Acme");
  });

  it("stage-derived range/evidence completions never surface a receipt (noExtractorYet)", () => {
    const modules: ModulesState = {
      anchor: completion("Engineer · Acme"),
    };
    expect(latestReceipt(modules)).toBe("Engineer · Acme"); // range/evidence being "done" via stage doesn't override
  });

  it("checkpoint_hunt is not a module key and never surfaces as a receipt", () => {
    const modules: ModulesState = { checkpoint_hunt: { fired_at: "2026-07-16T00:00:00.000Z" } };
    expect(latestReceipt(modules)).toBeNull();
  });
});
