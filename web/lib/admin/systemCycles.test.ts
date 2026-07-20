import { describe, expect, it } from "vitest";
import { buildFunnelFromCounters, getMostRecentScoringFunnel, listRecentHuntCycles } from "./systemCycles";

function chainable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "neq", "maybeSingle"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

function fakeAdmin(result: { data: unknown; error: unknown }) {
  return { from: (table: string) => (table === "hunt_cycles" ? chainable(result) : (() => { throw new Error(`unexpected table ${table}`); })()) } as never;
}

describe("listRecentHuntCycles", () => {
  it("maps rows and pulls stage4Calls out of counters", async () => {
    const admin = fakeAdmin({
      data: [
        {
          id: 2,
          started_at: "2026-07-05T00:00:00Z",
          mode: "full",
          triggered_by: "cron",
          users_scored: 3,
          postings_upserted: 10,
          counters: { stage4_calls: 7, boards_total: 40, boards_fetched: 38, boards_skipped_empty: 2 },
          cost_usd: 1.5,
          error: null,
        },
        {
          id: 1,
          started_at: "2026-07-04T00:00:00Z",
          mode: "discovery_only",
          triggered_by: "cron",
          users_scored: 0,
          postings_upserted: 5,
          counters: null,
          cost_usd: 0,
          error: "boom",
        },
      ],
      error: null,
    });

    const rows = await listRecentHuntCycles(admin);
    expect(rows).toEqual([
      {
        id: 2,
        startedAt: "2026-07-05T00:00:00Z",
        mode: "full",
        triggeredBy: "cron",
        usersScored: 3,
        postingsUpserted: 10,
        stage4Calls: 7,
        costUsd: 1.5,
        error: null,
        boardsTotal: 40,
        boardsFetched: 38,
        boardsSkippedEmpty: 2,
      },
      {
        id: 1,
        startedAt: "2026-07-04T00:00:00Z",
        mode: "discovery_only",
        triggeredBy: "cron",
        usersScored: 0,
        postingsUpserted: 5,
        stage4Calls: 0,
        costUsd: 0,
        error: "boom",
        boardsTotal: 0,
        boardsFetched: 0,
        boardsSkippedEmpty: 0,
      },
    ]);
  });

  it("returns an empty array when no cycles have run yet", async () => {
    const admin = fakeAdmin({ data: [], error: null });
    expect(await listRecentHuntCycles(admin)).toEqual([]);
  });

  it("throws on a database error", async () => {
    const admin = fakeAdmin({ data: null, error: new Error("boom") });
    await expect(listRecentHuntCycles(admin)).rejects.toThrow("boom");
  });
});

describe("buildFunnelFromCounters", () => {
  it("maps the five funnel stages in order from a fixture counters dict", () => {
    const counters = {
      postings_considered: 500,
      passed_title_filter: 300,
      postings_scored: 120,
      embedded: 80,
      stage4_calls: 20,
      // extra keys the funnel doesn't use should be ignored
      users_processed: 4,
    };
    expect(buildFunnelFromCounters(counters)).toEqual([
      { label: "Postings considered", count: 500 },
      { label: "Passed title filter", count: 300 },
      { label: "Rubric-scored", count: 120 },
      { label: "Embedded", count: 80 },
      { label: "LLM verdicts", count: 20 },
    ]);
  });

  it("defaults every stage to 0 for a null counters dict (discovery_only cycle)", () => {
    expect(buildFunnelFromCounters(null)).toEqual([
      { label: "Postings considered", count: 0 },
      { label: "Passed title filter", count: 0 },
      { label: "Rubric-scored", count: 0 },
      { label: "Embedded", count: 0 },
      { label: "LLM verdicts", count: 0 },
    ]);
  });
});

describe("getMostRecentScoringFunnel", () => {
  it("builds the funnel from the most recent non-discovery_only cycle", async () => {
    const admin = fakeAdmin({
      data: { counters: { postings_considered: 10, passed_title_filter: 8, postings_scored: 5, embedded: 4, stage4_calls: 2 } },
      error: null,
    });
    const funnel = await getMostRecentScoringFunnel(admin);
    expect(funnel).toEqual([
      { label: "Postings considered", count: 10 },
      { label: "Passed title filter", count: 8 },
      { label: "Rubric-scored", count: 5 },
      { label: "Embedded", count: 4 },
      { label: "LLM verdicts", count: 2 },
    ]);
  });

  it("returns null when no scoring cycle has run yet", async () => {
    const admin = fakeAdmin({ data: null, error: null });
    expect(await getMostRecentScoringFunnel(admin)).toBeNull();
  });

  it("throws on a database error", async () => {
    const admin = fakeAdmin({ data: null, error: new Error("boom") });
    await expect(getMostRecentScoringFunnel(admin)).rejects.toThrow("boom");
  });
});
