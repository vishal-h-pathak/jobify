import { describe, expect, it } from "vitest";
import { isStructuredModuleKey, MODULE_WRITERS, STRUCTURED_MODULE_KEYS } from "./index";

describe("STRUCTURED_MODULE_KEYS", () => {
  it("covers exactly the five structured modules this session owns", () => {
    expect([...STRUCTURED_MODULE_KEYS].sort()).toEqual(
      ["dealbreakers", "energy", "environment", "trajectory", "values"].sort()
    );
  });
});

describe("isStructuredModuleKey", () => {
  it("accepts every structured module key", () => {
    for (const key of STRUCTURED_MODULE_KEYS) expect(isStructuredModuleKey(key)).toBe(true);
  });

  it("rejects keys owned by other routes (anchor, reactions) and unknown keys", () => {
    expect(isStructuredModuleKey("anchor")).toBe(false);
    expect(isStructuredModuleKey("reactions")).toBe(false);
    expect(isStructuredModuleKey("bogus")).toBe(false);
  });
});

describe("MODULE_WRITERS", () => {
  it("has a registry entry for every structured module key", () => {
    for (const key of STRUCTURED_MODULE_KEYS) {
      expect(MODULE_WRITERS[key]).toBeDefined();
      expect(typeof MODULE_WRITERS[key].parseBody).toBe("function");
      expect(typeof MODULE_WRITERS[key].receipt).toBe("function");
      expect(typeof MODULE_WRITERS[key].applyToDoc).toBe("function");
    }
  });

  it("dealbreakers entry round-trips through the registry the same as the direct import", () => {
    const parsed = MODULE_WRITERS.dealbreakers.parseBody({ hard_disqualifiers: ["Crypto"] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(MODULE_WRITERS.dealbreakers.receipt(parsed.data)).toBe("1 dealbreakers");
      const doc = MODULE_WRITERS.dealbreakers.applyToDoc({ "disqualifiers.yml": "" }, parsed.data);
      expect(doc["disqualifiers.yml"]).toContain("Crypto");
    }
  });
});
