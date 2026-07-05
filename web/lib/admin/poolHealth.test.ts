import { describe, expect, it, afterEach } from "vitest";
import { getPoolHealth } from "./poolHealth";

const ORIGINAL_CAP = process.env.HOSTED_GLOBAL_MONTHLY_CAP_USD;
afterEach(() => {
  if (ORIGINAL_CAP === undefined) delete process.env.HOSTED_GLOBAL_MONTHLY_CAP_USD;
  else process.env.HOSTED_GLOBAL_MONTHLY_CAP_USD = ORIGINAL_CAP;
});

/** `postings` is queried twice per call (a head:true count, and a plain
 * select for the newest row) — the mock branches on which `.select()`
 * variant was used since both share the same `.from("postings")` chain. */
function postingsTable(countResult: { count: number; error: unknown }, newestResult: { data: unknown; error: unknown }) {
  let mode: "count" | "newest" = "newest";
  const chain: Record<string, unknown> = {
    select: (_col: string, opts?: { head?: boolean }) => {
      mode = opts?.head ? "count" : "newest";
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => chain,
  };
  chain.then = (resolve: (v: unknown) => void) =>
    resolve(mode === "count" ? { data: null, error: countResult.error, count: countResult.count } : newestResult);
  return chain;
}

function ledgerTable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "gte"]) chain[method] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

function fakeAdmin(opts: {
  count: { count: number; error: unknown };
  newest: { data: unknown; error: unknown };
  ledger: { data: unknown; error: unknown };
}) {
  // A fresh chain per `.from()` call — `postings` is queried twice
  // concurrently (Promise.all), so a shared instance would let the second
  // `.select()` call's mode leak into the first's `.then()`.
  return {
    from: (table: string) => {
      if (table === "postings") return postingsTable(opts.count, opts.newest);
      if (table === "budget_ledger") return ledgerTable(opts.ledger);
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe("getPoolHealth", () => {
  it("reports postings volume, newest last_seen_at, and the pool/BYO spend split", async () => {
    process.env.HOSTED_GLOBAL_MONTHLY_CAP_USD = "50";
    const admin = fakeAdmin({
      count: { count: 42, error: null },
      newest: { data: { last_seen_at: "2026-07-05T00:00:00Z" }, error: null },
      ledger: {
        data: [
          { cost_usd: 10, byo: false },
          { cost_usd: 5, byo: true },
          { cost_usd: 2.5, byo: false },
        ],
        error: null,
      },
    });

    const health = await getPoolHealth(admin);
    expect(health).toEqual({
      postingsCount: 42,
      newestLastSeenAt: "2026-07-05T00:00:00Z",
      poolSpendUsdMtd: 12.5,
      byoSpendUsdMtd: 5,
      globalCapUsd: 50,
    });
  });

  it("defaults the global cap to 100 when the env var is unset", async () => {
    delete process.env.HOSTED_GLOBAL_MONTHLY_CAP_USD;
    const admin = fakeAdmin({
      count: { count: 0, error: null },
      newest: { data: null, error: null },
      ledger: { data: [], error: null },
    });
    const health = await getPoolHealth(admin);
    expect(health.globalCapUsd).toBe(100);
    expect(health.newestLastSeenAt).toBeNull();
  });

  it("throws on a database error", async () => {
    const admin = fakeAdmin({
      count: { count: 0, error: new Error("boom") },
      newest: { data: null, error: null },
      ledger: { data: [], error: null },
    });
    await expect(getPoolHealth(admin)).rejects.toThrow("boom");
  });
});
