import { describe, expect, it, vi } from "vitest";
import { pollRuns, STALE_REAP_ERROR } from "./pollRuns";
import type { Database } from "../supabase/types";

type Row = Database["public"]["Tables"]["tailor_runs"]["Row"];

const FIXED_NOW = new Date("2026-07-16T12:00:00.000Z");
const STALE_MINUTES = 10;

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "run-1",
    user_id: "user-1",
    posting_id: "posting-1",
    status: "queued",
    mode: "tailor",
    template: null,
    feedback: null,
    progress: [],
    doc_sha256: null,
    dropped_count: null,
    error: null,
    cost_usd: null,
    created_at: FIXED_NOW.toISOString(),
    updated_at: FIXED_NOW.toISOString(),
    ...overrides,
  };
}

/**
 * Chainable fake authed client covering the one read this module performs:
 * `select("*").eq(user_id).eq(posting_id).order(created_at desc)`.
 */
function fakeSupabase(rows: Row[] | null, error: { message: string } | null = null) {
  const order = vi.fn(async () => ({ data: rows, error }));
  const eq2 = vi.fn(() => ({ order }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const supabase = { from: vi.fn(() => ({ select })) };
  return { supabase, select, eq1, eq2, order };
}

/** Chainable fake admin client covering the batched stale-reap update. */
function fakeAdmin(updateError: { message: string } | null = null) {
  const inFn = vi.fn(async () => ({ error: updateError }));
  const update = vi.fn(() => ({ in: inFn }));
  const admin = { from: vi.fn(() => ({ update })) };
  return { admin, update, in: inFn };
}

function baseDeps(overrides: Partial<Parameters<typeof pollRuns>[0]> = {}) {
  return {
    admin: fakeAdmin().admin as never,
    supabase: fakeSupabase([]).supabase as never,
    userId: "user-1",
    postingId: "posting-1",
    now: () => FIXED_NOW,
    staleMinutes: STALE_MINUTES,
    ...overrides,
  };
}

describe("pollRuns", () => {
  it("returns rows unmodified when none are stale", async () => {
    const { supabase } = fakeSupabase([row({ status: "queued", created_at: FIXED_NOW.toISOString() })]);
    const { admin, update } = fakeAdmin();
    const result = await pollRuns(baseDeps({ supabase: supabase as never, admin: admin as never }));

    expect(update).not.toHaveBeenCalled();
    expect(result.runs).toEqual([
      {
        id: "run-1",
        status: "queued",
        mode: "tailor",
        template: null,
        feedback: null,
        progress: [],
        dropped_count: null,
        error: null,
        cost_usd: null,
        created_at: FIXED_NOW.toISOString(),
        updated_at: FIXED_NOW.toISOString(),
      },
    ]);
    // trimmed response shape — user_id/posting_id/doc_sha256 must not leak
    expect(result.runs[0]).not.toHaveProperty("user_id");
    expect(result.runs[0]).not.toHaveProperty("posting_id");
    expect(result.runs[0]).not.toHaveProperty("doc_sha256");
  });

  it("reaps a queued row older than 10 minutes: admin update call + reaped status reflected in the response", async () => {
    const elevenMinutesAgo = new Date(FIXED_NOW.getTime() - 11 * 60 * 1000).toISOString();
    const { supabase } = fakeSupabase([row({ id: "run-stale", status: "queued", created_at: elevenMinutesAgo })]);
    const { admin, update, in: inFn } = fakeAdmin();
    const result = await pollRuns(baseDeps({ supabase: supabase as never, admin: admin as never }));

    expect(update).toHaveBeenCalledWith({
      status: "failed",
      error: STALE_REAP_ERROR,
      updated_at: FIXED_NOW.toISOString(),
    });
    expect(inFn).toHaveBeenCalledWith("id", ["run-stale"]);

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].status).toBe("failed");
    expect(result.runs[0].error).toBe(STALE_REAP_ERROR);
    expect(result.runs[0].updated_at).toBe(FIXED_NOW.toISOString());
  });

  it("does NOT reap a queued row exactly at 10 minutes minus one second (not yet stale)", async () => {
    const justUnderTenMinutesAgo = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 - 1000)).toISOString();
    const { supabase } = fakeSupabase([row({ status: "queued", created_at: justUnderTenMinutesAgo })]);
    const { admin, update } = fakeAdmin();
    const result = await pollRuns(baseDeps({ supabase: supabase as never, admin: admin as never }));

    expect(update).not.toHaveBeenCalled();
    expect(result.runs[0].status).toBe("queued");
  });

  it("does NOT reap a queued row exactly at the 10-minute mark (chosen boundary: strictly-greater-than is stale, not >=)", async () => {
    const exactlyTenMinutesAgo = new Date(FIXED_NOW.getTime() - 10 * 60 * 1000).toISOString();
    const { supabase } = fakeSupabase([row({ status: "queued", created_at: exactlyTenMinutesAgo })]);
    const { admin, update } = fakeAdmin();
    const result = await pollRuns(baseDeps({ supabase: supabase as never, admin: admin as never }));

    expect(update).not.toHaveBeenCalled();
    expect(result.runs[0].status).toBe("queued");
  });

  it("does NOT reap running/succeeded/failed rows regardless of age", async () => {
    const veryOld = new Date(FIXED_NOW.getTime() - 1000 * 60 * 1000).toISOString();
    const rows = [
      row({ id: "r-running", status: "running", created_at: veryOld }),
      row({ id: "r-succeeded", status: "succeeded", created_at: veryOld }),
      row({ id: "r-failed", status: "failed", created_at: veryOld, error: "already failed" }),
    ];
    const { supabase } = fakeSupabase(rows);
    const { admin, update } = fakeAdmin();
    const result = await pollRuns(baseDeps({ supabase: supabase as never, admin: admin as never }));

    expect(update).not.toHaveBeenCalled();
    expect(result.runs.map((r) => r.status)).toEqual(["running", "succeeded", "failed"]);
  });

  it("empty posting_id result set returns { runs: [] } without erroring", async () => {
    const { supabase } = fakeSupabase([]);
    const { admin, update } = fakeAdmin();
    const result = await pollRuns(baseDeps({ supabase: supabase as never, admin: admin as never }));

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ runs: [] });
  });

  it("throws on a SELECT error instead of swallowing it", async () => {
    const { supabase } = fakeSupabase(null, { message: "rls denied" });
    await expect(pollRuns(baseDeps({ supabase: supabase as never }))).rejects.toEqual({ message: "rls denied" });
  });

  it("throws on a stale-reap UPDATE error instead of swallowing it", async () => {
    const elevenMinutesAgo = new Date(FIXED_NOW.getTime() - 11 * 60 * 1000).toISOString();
    const { supabase } = fakeSupabase([row({ status: "queued", created_at: elevenMinutesAgo })]);
    const { admin } = fakeAdmin({ message: "update failed" });
    await expect(
      pollRuns(baseDeps({ supabase: supabase as never, admin: admin as never }))
    ).rejects.toEqual({ message: "update failed" });
  });

  it("queries scoped to the given user_id and posting_id, ordered by created_at desc", async () => {
    const { supabase, select, eq1, eq2, order } = fakeSupabase([]);
    await pollRuns(baseDeps({ supabase: supabase as never, userId: "user-42", postingId: "posting-99" }));

    expect(select).toHaveBeenCalledWith("*");
    expect(eq1).toHaveBeenCalledWith("user_id", "user-42");
    expect(eq2).toHaveBeenCalledWith("posting_id", "posting-99");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
});
