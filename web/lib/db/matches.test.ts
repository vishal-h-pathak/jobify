import { describe, expect, it } from "vitest";
import {
  bestScore,
  sortByBestScore,
  groupMatches,
  markSeenBulk,
  saveMatch,
  dismissMatch,
  undismissMatch,
  markApplied,
  runOptimisticTransition,
  type MatchRow,
  type FeedSupabaseClient,
} from "./matches";

/**
 * Minimal fake of supabase-js's chainable, thenable query builder —
 * mirrors `web/lib/db/invites.test.ts`'s fake pattern, extended to record
 * every call (method + args) so batching can be asserted.
 */
function fakeSupabase(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["update", "eq", "in", "select"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  const supabase = { from: () => chain } as unknown as FeedSupabaseClient;
  return { supabase, calls };
}

function throwingSupabase() {
  return {
    from: () => {
      throw new Error("from() should not be called");
    },
  } as unknown as FeedSupabaseClient;
}

function match(overrides: Partial<MatchRow>): MatchRow {
  return {
    user_id: "u1",
    posting_id: "p1",
    rubric_score: null,
    embed_score: null,
    llm_score: null,
    reason: null,
    reason_source: null,
    state: "new",
    state_changed_at: "2026-07-01T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("bestScore", () => {
  it("prefers llm_score over embed_score over rubric_score", () => {
    expect(bestScore({ llm_score: 0.9, embed_score: 0.5, rubric_score: 0.1 })).toBe(0.9);
    expect(bestScore({ llm_score: null, embed_score: 0.5, rubric_score: 0.1 })).toBe(0.5);
    expect(bestScore({ llm_score: null, embed_score: null, rubric_score: 0.1 })).toBe(0.1);
    expect(bestScore({ llm_score: null, embed_score: null, rubric_score: null })).toBeNull();
  });

  it("treats 0 as a real (non-null) score rather than falling through to the next stage", () => {
    expect(bestScore({ llm_score: 0, embed_score: 0.5, rubric_score: null })).toBe(0);
  });
});

describe("sortByBestScore", () => {
  it("orders llm > embed > rubric fallback, nulls last", () => {
    const low = match({ posting_id: "low", rubric_score: 0.2 });
    const high = match({ posting_id: "high", llm_score: 0.9 });
    const mid = match({ posting_id: "mid", embed_score: 0.5 });
    const none = match({ posting_id: "none" });
    expect(sortByBestScore([low, none, high, mid]).map((m) => m.posting_id)).toEqual([
      "high",
      "mid",
      "low",
      "none",
    ]);
  });
});

describe("groupMatches", () => {
  it("merges new + seen into the new bucket and separates the rest", () => {
    const rows = [
      match({ posting_id: "a", state: "new" }),
      match({ posting_id: "b", state: "seen" }),
      match({ posting_id: "c", state: "saved" }),
      match({ posting_id: "d", state: "applied" }),
      match({ posting_id: "e", state: "dismissed" }),
    ];
    const grouped = groupMatches(rows);
    expect(grouped.new.map((m) => m.posting_id)).toEqual(["a", "b"]);
    expect(grouped.saved.map((m) => m.posting_id)).toEqual(["c"]);
    expect(grouped.applied.map((m) => m.posting_id)).toEqual(["d"]);
    expect(grouped.dismissed.map((m) => m.posting_id)).toEqual(["e"]);
  });
});

describe("markSeenBulk", () => {
  it("issues one batched IN(...) update regardless of how many ids", async () => {
    const { supabase, calls } = fakeSupabase({ data: null, error: null });
    await markSeenBulk(supabase, ["p1", "p2", "p3"]);
    const inCalls = calls.filter((c) => c.method === "in");
    expect(inCalls).toHaveLength(1);
    expect(inCalls[0].args).toEqual(["posting_id", ["p1", "p2", "p3"]]);
    expect(calls.filter((c) => c.method === "update")).toHaveLength(1);
  });

  it("is a no-op that never touches the client when there are no ids", async () => {
    await expect(markSeenBulk(throwingSupabase(), [])).resolves.toBeUndefined();
  });

  it("throws on a database error", async () => {
    const { supabase } = fakeSupabase({ data: null, error: new Error("boom") });
    await expect(markSeenBulk(supabase, ["p1"])).rejects.toThrow("boom");
  });
});

describe("single-row state transitions", () => {
  const cases: Array<[string, (s: FeedSupabaseClient, id: string) => Promise<void>]> = [
    ["saveMatch", saveMatch],
    ["dismissMatch", dismissMatch],
    ["undismissMatch", undismissMatch],
    ["markApplied", markApplied],
  ];

  for (const [name, fn] of cases) {
    it(`${name} resolves when the update affects a row`, async () => {
      const { supabase } = fakeSupabase({ data: [{ posting_id: "p1" }], error: null });
      await expect(fn(supabase, "p1")).resolves.toBeUndefined();
    });

    it(`${name} throws when the update affects zero rows (RLS-regression-fails-loud)`, async () => {
      const { supabase } = fakeSupabase({ data: [], error: null });
      await expect(fn(supabase, "p1")).rejects.toThrow(/0 rows/);
    });

    it(`${name} throws on a database error rather than silently reporting success`, async () => {
      const { supabase } = fakeSupabase({ data: null, error: new Error("boom") });
      await expect(fn(supabase, "p1")).rejects.toThrow("boom");
    });
  }
});

describe("runOptimisticTransition", () => {
  it("applies immediately and leaves the applied state on success", async () => {
    let state = "seen";
    const result = await runOptimisticTransition({
      apply: () => {
        const prev = state;
        state = "dismissed";
        return prev;
      },
      revert: (prev) => {
        state = prev;
      },
      commit: async () => {},
    });
    expect(result).toEqual({ ok: true });
    expect(state).toBe("dismissed");
  });

  it("reverts to the pre-apply snapshot and surfaces the error when commit fails", async () => {
    let state = "seen";
    const result = await runOptimisticTransition({
      apply: () => {
        const prev = state;
        state = "dismissed";
        return prev;
      },
      revert: (prev) => {
        state = prev;
      },
      commit: async () => {
        throw new Error("update affected 0 rows");
      },
    });
    expect(result).toEqual({ ok: false, error: "update affected 0 rows" });
    expect(state).toBe("seen");
  });
});
