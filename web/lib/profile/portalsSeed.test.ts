import { describe, expect, it } from "vitest";
import { buildTitleFilter } from "./portalsSeed";

describe("buildTitleFilter", () => {
  it("guarantees all three lists are non-empty even with zero tiers (schema minItems: 1)", () => {
    const filter = buildTitleFilter({ tiers: [] });
    expect(filter.reject_substrings.length).toBeGreaterThan(0);
    expect(filter.prefer_substrings.length).toBeGreaterThan(0);
    expect(filter.seniority_substrings.length).toBeGreaterThan(0);
  });

  it("seeds prefer_substrings from tier labels when present", () => {
    const filter = buildTitleFilter({ tiers: [{ label: "Platform engineering" }, { label: "ML infra" }] });
    expect(filter.prefer_substrings).toEqual(["Platform engineering", "ML infra"]);
  });

  it("dedupes repeated tier labels", () => {
    const filter = buildTitleFilter({ tiers: [{ label: "Backend" }, { label: "Backend" }] });
    expect(filter.prefer_substrings).toEqual(["Backend"]);
  });
});
