import { describe, expect, it } from "vitest";
import { claimInvite, hasClaimedInvite } from "./invites";

/**
 * Minimal fake of supabase-js's chainable, thenable query builder — each
 * method returns `this`, and awaiting the chain resolves to the
 * configured `{ data, error }` (mirroring how supabase-js's builder is
 * itself a thenable, no `.execute()` call needed).
 */
function fakeSupabase(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const chainable = ["update", "eq", "is", "select", "limit"];
  for (const method of chainable) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return {
    from: () => chain,
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(result);
    },
  } as never;
}

const rpcCalls: Array<{ fn: string; args: unknown }> = [];

describe("claimInvite", () => {
  it("returns true when claim_invite reports success and passes the code through", async () => {
    const supabase = fakeSupabase({ data: true, error: null });
    const claimed = await claimInvite(supabase, "ABC123");
    expect(claimed).toBe(true);
    expect(rpcCalls.at(-1)).toEqual({ fn: "claim_invite", args: { invite_code: "ABC123" } });
  });

  it("returns false when claim_invite reports failure (invalid or already-claimed code) — this is the invite gate", async () => {
    const supabase = fakeSupabase({ data: false, error: null });
    const claimed = await claimInvite(supabase, "ALREADY-USED");
    expect(claimed).toBe(false);
  });

  it("throws on a database error rather than silently reporting success", async () => {
    const supabase = fakeSupabase({ data: null, error: new Error("boom") });
    await expect(claimInvite(supabase, "ABC123")).rejects.toThrow("boom");
  });
});

describe("hasClaimedInvite", () => {
  it("is false when the user holds no claimed invite (blocks the app gate)", async () => {
    const supabase = fakeSupabase({ data: [], error: null });
    expect(await hasClaimedInvite(supabase)).toBe(false);
  });

  it("is true once the user's own claimed row is visible", async () => {
    const supabase = fakeSupabase({ data: [{ code: "ABC123" }], error: null });
    expect(await hasClaimedInvite(supabase)).toBe(true);
  });
});
