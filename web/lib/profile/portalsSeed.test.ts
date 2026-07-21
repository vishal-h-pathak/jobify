import { describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import {
  buildPortalsDoc,
  buildTitleFilter,
  mergeCompaniesBySlug,
  seedPortalsCompanies,
  type CatalogBoardRef,
} from "./portalsSeed";
import type { SlugProbeResult } from "../portals/slugProbe";

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

  it("ONB-A: seeds prefer_substrings with the anchor's current_title alongside tier labels", () => {
    const filter = buildTitleFilter({ tiers: [{ label: "Platform engineering" }] }, "Senior Backend Engineer");
    expect(filter.prefer_substrings).toEqual(["Platform engineering", "Senior Backend Engineer"]);
  });

  it("ONB-A: dedupes the anchor title against an identical tier label", () => {
    const filter = buildTitleFilter({ tiers: [{ label: "Backend Engineer" }] }, "Backend Engineer");
    expect(filter.prefer_substrings).toEqual(["Backend Engineer"]);
  });

  it("ONB-A: anchor title alone (no tiers) still seeds prefer_substrings", () => {
    const filter = buildTitleFilter({ tiers: [] }, "Data Scientist");
    expect(filter.prefer_substrings).toEqual(["Data Scientist"]);
  });
});

describe("buildPortalsDoc", () => {
  it("still ships empty company lists when no companies are supplied (live-preview path)", () => {
    const doc = buildPortalsDoc({ tiers: [] }) as Record<string, { companies: unknown[] }>;
    expect(doc.greenhouse.companies).toEqual([]);
    expect(doc.lever.companies).toEqual([]);
    expect(doc.ashby.companies).toEqual([]);
  });

  it("populates per-ATS company lists when supplied", () => {
    const doc = buildPortalsDoc({ tiers: [] }, undefined, {
      greenhouse: [{ slug: "acme", name: "Acme" }],
      lever: [],
      ashby: [{ slug: "beta", name: "Beta Co" }],
      workday: [],
    }) as Record<string, { companies: unknown[] }>;
    expect(doc.greenhouse.companies).toEqual([{ slug: "acme", name: "Acme" }]);
    expect(doc.ashby.companies).toEqual([{ slug: "beta", name: "Beta Co" }]);
  });

  it("decodes a workday seed's encoded slug back into tenant/site/dc (HUNT2 P3 S6)", () => {
    const doc = buildPortalsDoc({ tiers: [] }, undefined, {
      greenhouse: [], lever: [], ashby: [],
      workday: [{ slug: "acme/wd1/External", name: "Acme Corp" }],
    }) as Record<string, { companies: unknown[] }>;
    expect(doc.workday.companies).toEqual([{ tenant: "acme", dc: "wd1", site: "External", name: "Acme Corp" }]);
  });

  it("drops a malformed workday slug instead of writing it out half-decoded", () => {
    const doc = buildPortalsDoc({ tiers: [] }, undefined, {
      greenhouse: [], lever: [], ashby: [],
      workday: [{ slug: "not-a-valid-slug", name: "Broken Co" }],
    }) as Record<string, { companies: unknown[] }>;
    expect(doc.workday.companies).toEqual([]);
  });
});

describe("mergeCompaniesBySlug", () => {
  it("unions by slug with existing entries winning on conflict", () => {
    const merged = mergeCompaniesBySlug(
      [{ slug: "acme", name: "Hand-Seeded Acme" }],
      [
        { slug: "acme", name: "Probed Acme Corp" },
        { slug: "beta", name: "Beta Co" },
      ]
    );
    expect(merged).toEqual([
      { slug: "acme", name: "Hand-Seeded Acme" },
      { slug: "beta", name: "Beta Co" },
    ]);
  });

  it("handles a null/undefined existing list", () => {
    expect(mergeCompaniesBySlug(undefined, [{ slug: "acme", name: "Acme" }])).toEqual([
      { slug: "acme", name: "Acme" },
    ]);
  });
});

describe("seedPortalsCompanies", () => {
  function hit(ats: "greenhouse" | "ashby" | "lever", slug: string, confidence: number): SlugProbeResult {
    return { found: true, ats, slug, confidence, livePostingCount: 5 };
  }
  const miss: SlugProbeResult = { found: false, reason: "no matching board" };

  it("seeds high-confidence dream-company hits, first, ahead of the tier pack", async () => {
    const probe = vi.fn(async (name: string) => {
      if (name === "Acme") return hit("greenhouse", "acme", 0.9);
      return miss;
    });
    const tierPackBoards: CatalogBoardRef[] = [{ ats: "ashby", slug: "packco", name: "PackCo" }];

    const result = await seedPortalsCompanies({
      targeting: { tiers: [] },
      dreamCompanies: ["Acme", "Ghost Company"],
      tierPackBoards,
      probe,
    });

    expect(result.portalsYaml).toContain("acme");
    expect(result.portalsYaml).toContain("packco");
    expect(result.couldntAutoFind).toEqual(["Ghost Company"]);
  });

  it("routes low-confidence probe hits to couldntAutoFind instead of seeding them", async () => {
    const probe = vi.fn(async () => hit("greenhouse", "impostor-co", 0.2));

    const result = await seedPortalsCompanies({
      targeting: { tiers: [] },
      dreamCompanies: ["Sketchy Co"],
      probe,
    });

    expect(result.portalsYaml).not.toContain("impostor-co");
    expect(result.couldntAutoFind).toEqual(["Sketchy Co"]);
  });

  it("merge-not-replace: protects a user's existing hand-seeded boards", async () => {
    const probe = vi.fn(async () => hit("greenhouse", "newco", 0.9));
    const existingDoc = {
      greenhouse: { companies: [{ slug: "handseeded", name: "Hand Seeded Co" }] },
    };

    const result = await seedPortalsCompanies({
      targeting: { tiers: [] },
      dreamCompanies: ["New Co"],
      existingDoc,
      probe,
    });

    expect(result.portalsYaml).toContain("handseeded");
    expect(result.portalsYaml).toContain("newco");
  });

  it("caps total seeded companies at seedCap, dream hits first", async () => {
    const probe = vi.fn(async () => hit("greenhouse", "dreamco", 0.9));
    const tierPackBoards: CatalogBoardRef[] = Array.from({ length: 5 }, (_, i) => ({
      ats: "ashby" as const,
      slug: `pack-${i}`,
      name: `Pack ${i}`,
    }));

    const result = await seedPortalsCompanies({
      targeting: { tiers: [] },
      dreamCompanies: ["Dream Co"],
      tierPackBoards,
      probe,
      seedCap: 3,
    });

    const doc = yamlParse(result.portalsYaml);
    const total = doc.greenhouse.companies.length + doc.ashby.companies.length;
    expect(total).toBe(3);
    expect(doc.greenhouse.companies).toEqual([{ slug: "dreamco", name: "Dream Co" }]);
    expect(doc.ashby.companies.map((c: { slug: string }) => c.slug)).toEqual(["pack-0", "pack-1"]);
  });
});

function yamlParse(text: string): {
  greenhouse: { companies: Array<{ slug: string; name: string }> };
  ashby: { companies: Array<{ slug: string; name: string }> };
} {
  return yaml.load(text) as ReturnType<typeof yamlParse>;
}
