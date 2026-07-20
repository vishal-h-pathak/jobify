import { describe, expect, it } from "vitest";
import { seedUserPortals } from "./seedUserPortals";

/**
 * Per-table fake mirroring web/lib/admin/allowlist.test.ts's chainable-
 * thenable pattern, but dispatching on the table name since this function
 * reads three tables and writes a fourth. `dream_companies` is left empty
 * in every fixture below so `seedPortalsCompanies` never calls the real
 * network slug-probe (see portalsSeed.ts: an empty dream-company list
 * short-circuits `Promise.all([])`).
 */
function fakeAdmin(tables: {
  onboarding_sessions?: { data: unknown; error: unknown };
  profiles?: { data: unknown; error: unknown };
  board_catalog?: { data: unknown; error: unknown };
}) {
  const updateCalls: Array<{ table: string; payload: unknown }> = [];

  function chainFor(table: string, result: { data: unknown; error: unknown } | undefined) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "maybeSingle"]) {
      chain[method] = () => chain;
    }
    chain.update = (payload: unknown) => {
      updateCalls.push({ table, payload });
      return { eq: () => Promise.resolve({ error: null }) };
    };
    chain.then = (resolve: (v: unknown) => void) => resolve(result ?? { data: null, error: null });
    return chain;
  }

  const admin = {
    from: (table: string) => chainFor(table, (tables as Record<string, { data: unknown; error: unknown }>)[table]),
  };
  return { admin: admin as never, updateCalls };
}

const baseSession = {
  data: {
    extracted: {
      anchor: { current_title: "Staff Engineer" },
      targeting: {
        tiers: [{ label: "Data/AI" }],
        hard_disqualifiers: [],
        soft_concerns: [],
        dream_companies: [] as string[],
      },
    },
  },
  error: null,
};

const baseProfile = {
  data: { doc: { "portals.yml": "", "profile.yml": "" } },
  error: null,
};

const emptyCatalog = { data: [], error: null };

describe("seedUserPortals", () => {
  it("throws when no onboarding_sessions row exists for the user", async () => {
    const { admin } = fakeAdmin({
      onboarding_sessions: { data: null, error: null },
      profiles: baseProfile,
      board_catalog: emptyCatalog,
    });
    await expect(seedUserPortals(admin as never, "user-1")).rejects.toThrow(/no onboarding_sessions row/);
  });

  it("throws when no profiles row exists for the user", async () => {
    const { admin } = fakeAdmin({
      onboarding_sessions: baseSession,
      profiles: { data: null, error: null },
      board_catalog: emptyCatalog,
    });
    await expect(seedUserPortals(admin as never, "user-1")).rejects.toThrow(/no profiles row/);
  });

  it("writes portals.yml back to profiles.doc, merge-not-replace with existing doc keys preserved", async () => {
    const { admin, updateCalls } = fakeAdmin({
      onboarding_sessions: baseSession,
      profiles: { data: { doc: { "portals.yml": "", "profile.yml": "", "cv.md": "unrelated, must survive" } }, error: null },
      board_catalog: emptyCatalog,
    });

    const result = await seedUserPortals(admin as never, "user-1");

    expect(result.dreamCompaniesCount).toBe(0);
    expect(updateCalls).toHaveLength(1);
    const payload = (updateCalls[0].payload as { doc: Record<string, string> }).doc;
    expect(payload["cv.md"]).toBe("unrelated, must survive");
    expect(typeof payload["portals.yml"]).toBe("string");
    expect(payload["portals.yml"].length).toBeGreaterThan(0);
    expect(JSON.parse(payload["portals.couldnt_auto_find.json"])).toEqual([]);
  });

  it("hotfix 2026-07-20: profile.yml's location_and_compensation wins over the regex fallback", async () => {
    // Text alone would match the old /onsite only/ regex and conclude
    // remote-REQUIRED — but this user has a base metro, so profile.yml's
    // structured section must override that to remote-NOT-required.
    const { admin } = fakeAdmin({
      onboarding_sessions: {
        data: {
          extracted: {
            anchor: { current_title: "Staff Engineer" },
            targeting: {
              tiers: [{ label: "Data/AI" }],
              hard_disqualifiers: ["onsite only acceptable if based in Atlanta"],
              soft_concerns: [],
              dream_companies: [],
            },
          },
        },
        error: null,
      },
      profiles: {
        data: {
          doc: {
            "portals.yml": "",
            "profile.yml": "location_and_compensation:\n  base: Atlanta, GA\n  remote_acceptable: true\n",
          },
        },
        error: null,
      },
      board_catalog: emptyCatalog,
    });

    const result = await seedUserPortals(admin as never, "user-1");
    expect(result.remoteRequiredSource).toBe("profile.yml");
    expect(result.remoteRequired).toBe(false);
  });

  it("falls back to the text regex only when profile.yml has no location_and_compensation section", async () => {
    const { admin } = fakeAdmin({
      onboarding_sessions: {
        data: {
          extracted: {
            anchor: { current_title: "Staff Engineer" },
            targeting: {
              tiers: [{ label: "Data/AI" }],
              hard_disqualifiers: ["fully in-office"],
              soft_concerns: [],
              dream_companies: [],
            },
          },
        },
        error: null,
      },
      profiles: baseProfile,
      board_catalog: emptyCatalog,
    });

    const result = await seedUserPortals(admin as never, "user-1");
    expect(result.remoteRequiredSource).toBe("regex fallback");
    expect(result.remoteRequired).toBe(true);
  });
});
