import { describe, expect, it } from "vitest";
import { aggregateEngagement, aggregateLedgerCosts, getCostBreakdownMtd, getEngagementSnapshot, getPoolFreshness } from "./systemMetrics";

function chainable(result: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "order", "limit", "maybeSingle"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

describe("aggregateLedgerCosts", () => {
  it("groups by event, by model, and pool-vs-BYO", () => {
    const rows = [
      { event: "stage4_verdict", model: "claude-haiku", cost_usd: 1, byo: false },
      { event: "stage4_verdict", model: "claude-haiku", cost_usd: 2, byo: false },
      { event: "stage4_verdict", model: "claude-sonnet", cost_usd: 4, byo: true },
      { event: "embedding", model: "text-embed", cost_usd: 0.5, byo: false },
    ];
    expect(aggregateLedgerCosts(rows)).toEqual({
      byEvent: { stage4_verdict: 7, embedding: 0.5 },
      byModel: { "claude-haiku": 3, "claude-sonnet": 4, "text-embed": 0.5 },
      poolUsd: 3.5,
      byoUsd: 4,
    });
  });

  it("returns all-zero breakdowns for no rows", () => {
    expect(aggregateLedgerCosts([])).toEqual({ byEvent: {}, byModel: {}, poolUsd: 0, byoUsd: 0 });
  });

  it("buckets a null model under '(no model)'", () => {
    const result = aggregateLedgerCosts([{ event: "x", model: null, cost_usd: 1, byo: false }]);
    expect(result.byModel["(no model)"]).toBe(1);
  });
});

describe("getCostBreakdownMtd", () => {
  it("fetches this month's ledger rows and aggregates them", async () => {
    const admin = {
      from: (table: string) =>
        table === "budget_ledger"
          ? chainable({
              data: [
                { event: "stage4_verdict", model: "claude-haiku", cost_usd: 3, byo: false },
                { event: "stage4_verdict", model: "claude-haiku", cost_usd: 1, byo: true },
              ],
              error: null,
            })
          : (() => {
              throw new Error(`unexpected table ${table}`);
            })(),
    } as never;
    const breakdown = await getCostBreakdownMtd(admin);
    expect(breakdown).toEqual({
      byEvent: { stage4_verdict: 4 },
      byModel: { "claude-haiku": 4 },
      poolUsd: 3,
      byoUsd: 1,
    });
  });

  it("throws on a database error", async () => {
    const admin = { from: () => chainable({ data: null, error: new Error("boom") }) } as never;
    await expect(getCostBreakdownMtd(admin)).rejects.toThrow("boom");
  });
});

describe("aggregateEngagement", () => {
  const now = new Date("2026-07-05T00:00:00Z");
  const eightDaysAgo = "2026-06-27T00:00:00Z";
  const twoDaysAgo = "2026-07-03T00:00:00Z";

  it("computes all-time + last-7-days totals by state, the ratio, and per-user applied counts", () => {
    const rows = [
      { user_id: "u1", state: "saved" as const, state_changed_at: twoDaysAgo },
      { user_id: "u1", state: "saved" as const, state_changed_at: eightDaysAgo },
      { user_id: "u2", state: "dismissed" as const, state_changed_at: twoDaysAgo },
      { user_id: "u1", state: "applied" as const, state_changed_at: twoDaysAgo },
      { user_id: "u2", state: "applied" as const, state_changed_at: eightDaysAgo },
      { user_id: "u2", state: "applied" as const, state_changed_at: twoDaysAgo },
      { user_id: "u3", state: "new" as const, state_changed_at: twoDaysAgo },
    ];

    const snapshot = aggregateEngagement(rows, now);
    expect(snapshot.totalsByState).toEqual({ new: 1, seen: 0, saved: 2, dismissed: 1, applied: 3 });
    expect(snapshot.last7DaysByState).toEqual({ new: 1, seen: 0, saved: 1, dismissed: 1, applied: 2 });
    expect(snapshot.savesToDismissalsRatio).toBe(2);
    expect(snapshot.appliedByUser.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: "u1", count: 1 },
      { userId: "u2", count: 2 },
    ]);
  });

  it("returns null (not Infinity/NaN) for the ratio when there are no dismissals", () => {
    const rows = [{ user_id: "u1", state: "saved" as const, state_changed_at: twoDaysAgo }];
    expect(aggregateEngagement(rows, now).savesToDismissalsRatio).toBeNull();
  });

  it("returns all-zero totals and an empty applied list for no rows", () => {
    const snapshot = aggregateEngagement([], now);
    expect(snapshot.totalsByState).toEqual({ new: 0, seen: 0, saved: 0, dismissed: 0, applied: 0 });
    expect(snapshot.last7DaysByState).toEqual({ new: 0, seen: 0, saved: 0, dismissed: 0, applied: 0 });
    expect(snapshot.savesToDismissalsRatio).toBeNull();
    expect(snapshot.appliedByUser).toEqual([]);
  });
});

describe("getEngagementSnapshot", () => {
  it("fetches matches and aggregates them", async () => {
    const admin = {
      from: (table: string) =>
        table === "matches"
          ? chainable({ data: [{ user_id: "u1", state: "saved", state_changed_at: "2026-07-04T00:00:00Z" }], error: null })
          : (() => {
              throw new Error(`unexpected table ${table}`);
            })(),
    } as never;
    const snapshot = await getEngagementSnapshot(admin);
    expect(snapshot.totalsByState.saved).toBe(1);
  });

  it("throws on a database error", async () => {
    const admin = { from: () => chainable({ data: null, error: new Error("boom") }) } as never;
    await expect(getEngagementSnapshot(admin)).rejects.toThrow("boom");
  });
});

/** `postings` is queried four times per `getPoolFreshness` call (count,
 * newest, oldest, expired-count) — the mock branches on `.select()`'s
 * arguments (head + eq filter) so each independent query in the
 * `Promise.all` resolves to its own fixture, mirroring `poolHealth.
 * test.ts`'s reasoning for why a fresh chain per `.from()` call matters. */
function postingsTable(fixtures: {
  count: { count: number; error: unknown };
  newest: { data: unknown; error: unknown };
  oldest: { data: unknown; error: unknown };
  expired: { count: number; error: unknown };
}) {
  return {
    select: (_col: string, opts?: { head?: boolean }) => {
      if (opts?.head) {
        // Distinguished from the expired-count query by whether `.eq()` is called next.
        const chain: Record<string, unknown> = {
          eq: () => ({
            then: (resolve: (v: unknown) => void) => resolve({ data: null, error: fixtures.expired.error, count: fixtures.expired.count }),
          }),
          then: (resolve: (v: unknown) => void) => resolve({ data: null, error: fixtures.count.error, count: fixtures.count.count }),
        };
        return chain;
      }
      // newest vs oldest is distinguished by ascending/descending order.
      const chain: Record<string, unknown> = {
        order: (_col2: string, opts2?: { ascending?: boolean }) => {
          const result = opts2?.ascending ? fixtures.oldest : fixtures.newest;
          return {
            limit: () => ({
              maybeSingle: () => Promise.resolve(result),
            }),
          };
        },
      };
      return chain;
    },
  };
}

describe("getPoolFreshness", () => {
  it("reports postings count, newest/oldest last_seen_at, and the expired count", async () => {
    const admin = {
      from: (table: string) =>
        table === "postings"
          ? postingsTable({
              count: { count: 100, error: null },
              newest: { data: { last_seen_at: "2026-07-05T00:00:00Z" }, error: null },
              oldest: { data: { last_seen_at: "2026-01-01T00:00:00Z" }, error: null },
              expired: { count: 12, error: null },
            })
          : (() => {
              throw new Error(`unexpected table ${table}`);
            })(),
    } as never;

    expect(await getPoolFreshness(admin)).toEqual({
      postingsCount: 100,
      newestLastSeenAt: "2026-07-05T00:00:00Z",
      oldestLastSeenAt: "2026-01-01T00:00:00Z",
      expiredCount: 12,
    });
  });

  it("handles an empty postings table gracefully", async () => {
    const admin = {
      from: (table: string) =>
        table === "postings"
          ? postingsTable({
              count: { count: 0, error: null },
              newest: { data: null, error: null },
              oldest: { data: null, error: null },
              expired: { count: 0, error: null },
            })
          : (() => {
              throw new Error(`unexpected table ${table}`);
            })(),
    } as never;

    expect(await getPoolFreshness(admin)).toEqual({
      postingsCount: 0,
      newestLastSeenAt: null,
      oldestLastSeenAt: null,
      expiredCount: 0,
    });
  });

  it("throws on a database error", async () => {
    const admin = {
      from: (table: string) =>
        table === "postings"
          ? postingsTable({
              count: { count: 0, error: new Error("boom") },
              newest: { data: null, error: null },
              oldest: { data: null, error: null },
              expired: { count: 0, error: null },
            })
          : (() => {
              throw new Error(`unexpected table ${table}`);
            })(),
    } as never;
    await expect(getPoolFreshness(admin)).rejects.toThrow("boom");
  });
});
