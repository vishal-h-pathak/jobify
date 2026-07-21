import { describe, expect, it } from "vitest";
import { getSourceFunnel, setBoardDormant } from "./sourceHealth";

function fakeSourceFunnelAdmin(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return { admin: { from: () => chain } as never, calls };
}

describe("getSourceFunnel", () => {
  it("maps a paid-query row and derives the rotate flag on zero surfaced_60d", async () => {
    const { admin } = fakeSourceFunnelAdmin({
      data: [{
        source: "jsearch", query_key: "staff platform engineer", board_id: null,
        board_company_name: null, board_status: null, postings_60d: 3, postings_90d: 5,
        surfaced_60d: 0, surfaced_90d: 0, users_engaged_60d: 0, users_engaged_90d: 0,
      }],
      error: null,
    });

    const rows = await getSourceFunnel(admin);

    expect(rows).toEqual([{
      source: "jsearch", queryKey: "staff platform engineer", boardId: null,
      boardCompanyName: null, boardStatus: null, postings60d: 3, postings90d: 5,
      surfaced60d: 0, surfaced90d: 0, usersEngaged60d: 0, usersEngaged90d: 0,
      rotate: true, dormantCandidate: false,
    }]);
  });

  it("does not flag rotate when the paid query has surfaced matches in 60 days", async () => {
    const { admin } = fakeSourceFunnelAdmin({
      data: [{
        source: "jsearch", query_key: "staff platform engineer", board_id: null,
        board_company_name: null, board_status: null, postings_60d: 3, postings_90d: 5,
        surfaced_60d: 2, surfaced_90d: 2, users_engaged_60d: 1, users_engaged_90d: 1,
      }],
      error: null,
    });

    const rows = await getSourceFunnel(admin);
    expect(rows[0].rotate).toBe(false);
  });

  it("derives the dormant-candidate flag on an active board with zero surfaced_90d", async () => {
    const { admin } = fakeSourceFunnelAdmin({
      data: [{
        source: "greenhouse", query_key: null, board_id: "b1", board_company_name: "Acme Corp",
        board_status: "active", postings_60d: 4, postings_90d: 6, surfaced_60d: 0, surfaced_90d: 0,
        users_engaged_60d: 0, users_engaged_90d: 0,
      }],
      error: null,
    });

    const rows = await getSourceFunnel(admin);
    expect(rows[0].dormantCandidate).toBe(true);
  });

  it("never flags dormant-candidate for a board that's already dormant or dead", async () => {
    const { admin } = fakeSourceFunnelAdmin({
      data: [{
        source: "greenhouse", query_key: null, board_id: "b1", board_company_name: "Acme Corp",
        board_status: "dead", postings_60d: 0, postings_90d: 0, surfaced_60d: 0, surfaced_90d: 0,
        users_engaged_60d: 0, users_engaged_90d: 0,
      }],
      error: null,
    });

    const rows = await getSourceFunnel(admin);
    expect(rows[0].dormantCandidate).toBe(false);
  });

  it("throws on a database error", async () => {
    const { admin } = fakeSourceFunnelAdmin({ data: null, error: new Error("boom") });
    await expect(getSourceFunnel(admin)).rejects.toThrow("boom");
  });
});

describe("setBoardDormant", () => {
  function fakeBoardCatalogAdmin(row: { status: string } | null) {
    const updateCalls: unknown[] = [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) {
      chain[method] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
    chain.update = (payload: unknown) => {
      updateCalls.push(payload);
      return { eq: () => Promise.resolve({ error: null }) };
    };
    return { admin: { from: () => chain } as never, updateCalls };
  }

  it("returns not_found when the board doesn't exist", async () => {
    const { admin } = fakeBoardCatalogAdmin(null);
    expect(await setBoardDormant(admin, "missing")).toEqual({ kind: "not_found" });
  });

  it("returns not_active when the board is already dormant or dead", async () => {
    const { admin, updateCalls } = fakeBoardCatalogAdmin({ status: "dead" });
    expect(await setBoardDormant(admin, "b1")).toEqual({ kind: "not_active" });
    expect(updateCalls).toHaveLength(0);
  });

  it("updates status to dormant for an active board", async () => {
    const { admin, updateCalls } = fakeBoardCatalogAdmin({ status: "active" });
    const result = await setBoardDormant(admin, "b1");
    expect(result).toEqual({ kind: "ok" });
    expect(updateCalls).toEqual([{ status: "dormant" }]);
  });
});
