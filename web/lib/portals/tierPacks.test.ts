import { describe, expect, it } from "vitest";
import { computeTierPack, deriveTagsFromKeywords, type CatalogBoardInput } from "./tierPacks";

const FIXTURE_CATALOG: CatalogBoardInput[] = [
  { ats: "greenhouse", slug: "infraco", company_name: "InfraCo", tags: ["infra", "devtools"] },
  { ats: "ashby", slug: "platformly", company_name: "Platformly", tags: ["infra", "remote-first"] },
  { ats: "ashby", slug: "growthy", company_name: "Growthy", tags: ["product", "growth-startup"] },
  { ats: "greenhouse", slug: "bigco", company_name: "BigCo", tags: ["big-tech-adjacent", "enterprise"] },
  { ats: "lever", slug: "mlshop", company_name: "MLShop", tags: ["data-ai", "growth-startup"] },
];

describe("deriveTagsFromKeywords", () => {
  it("maps infra/platform/SRE keywords to infra ∪ devtools", () => {
    expect(deriveTagsFromKeywords("Senior Platform Engineer, SRE lane")).toEqual(
      new Set(["infra", "devtools"])
    );
  });

  it("maps ML/data keywords to data-ai", () => {
    expect(deriveTagsFromKeywords("Machine Learning Engineer")).toEqual(new Set(["data-ai"]));
  });

  it("returns an empty set for unrecognized text", () => {
    expect(deriveTagsFromKeywords("Executive Assistant")).toEqual(new Set());
  });

  it("unions tags across multiple matching rules", () => {
    const tags = deriveTagsFromKeywords("Founding infra engineer at an early stage startup");
    expect(tags.has("infra")).toBe(true);
    expect(tags.has("devtools")).toBe(true);
    expect(tags.has("growth-startup")).toBe(true);
  });
});

describe("computeTierPack", () => {
  it("ranks infra-tagged boards first for an infra/platform/SRE targeting profile", () => {
    const pack = computeTierPack({ tiers: [{ label: "Senior Platform / SRE Engineer" }] }, FIXTURE_CATALOG);
    expect(pack.map((b) => b.slug)).toEqual(["infraco", "platformly"]);
  });

  it("includes a workday-ats catalog row (HUNT2 P3 S6: no longer excluded)", () => {
    const catalogWithWorkday: CatalogBoardInput[] = [
      ...FIXTURE_CATALOG,
      { ats: "workday", slug: "megacorp/wd1/External", company_name: "MegaCorp", tags: ["infra", "enterprise"] },
    ];
    const pack = computeTierPack({ tiers: [{ label: "Senior Platform Engineer" }] }, catalogWithWorkday);
    expect(pack).toContainEqual({ ats: "workday", slug: "megacorp/wd1/External", name: "MegaCorp" });
  });

  it("intersects with remote-first when remote is required, even if it drops otherwise-relevant boards", () => {
    const pack = computeTierPack(
      { tiers: [{ label: "Senior Platform / SRE Engineer" }], remoteRequired: true },
      FIXTURE_CATALOG
    );
    // infraco matches infra/devtools but isn't remote-first -> excluded.
    expect(pack.map((b) => b.slug)).toEqual(["platformly"]);
  });

  it("falls back to the full (remote-filtered) catalog order when no keyword rule fires", () => {
    const pack = computeTierPack({ tiers: [{ label: "Executive Assistant" }] }, FIXTURE_CATALOG);
    expect(pack.map((b) => b.slug)).toEqual(["infraco", "platformly", "growthy", "bigco", "mlshop"]);
  });

  it("caps the pack at the given size", () => {
    const pack = computeTierPack({ tiers: [{ label: "Engineer" }] }, FIXTURE_CATALOG, 2);
    expect(pack.length).toBe(2);
  });

  it("returns catalog boards as {ats, slug, name} refs", () => {
    const pack = computeTierPack({ tiers: [{ label: "ML Engineer" }] }, FIXTURE_CATALOG);
    expect(pack).toEqual([{ ats: "lever", slug: "mlshop", name: "MLShop" }]);
  });

  it("returns an empty pack when remote is required and nothing in the catalog is remote-first-tagged plus relevant", () => {
    const pack = computeTierPack(
      { tiers: [{ label: "ML Engineer" }], remoteRequired: true },
      FIXTURE_CATALOG
    );
    expect(pack).toEqual([]);
  });
});
