import { describe, expect, it, vi } from "vitest";
import { dispatchTailor } from "./dispatchTailor";

const FIXED_NOW = new Date("2026-07-16T12:00:00.000Z");

/**
 * Chainable fake admin client covering the three `tailor_runs` operations
 * this module performs: the daily-count select, the insert (+ select/single
 * to get the new row's id), and the failure-path update. Each is
 * independently overridable per test.
 */
function fakeAdmin(
  opts: {
    count?: number;
    countError?: { message: string } | null;
    insertResult?: { data: { id: string } | null; error: { code?: string; message: string } | null };
    updateError?: { message: string } | null;
  } = {}
) {
  const count = opts.count ?? 0;
  const countError = opts.countError ?? null;
  const insertResult = opts.insertResult ?? { data: { id: "run-1" }, error: null };
  const updateError = opts.updateError ?? null;

  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: updateError })) }));
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => insertResult),
    })),
  }));
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        gte: vi.fn(async () => ({ count, error: countError })),
      })),
    })),
  }));

  const admin = {
    from: vi.fn(() => ({ select, insert, update })),
  };
  return { admin, update, insert, select };
}

function baseDeps(overrides: Partial<Parameters<typeof dispatchTailor>[0]> = {}) {
  return {
    admin: fakeAdmin().admin as never,
    targetUserId: "user-1",
    postingId: "posting-1",
    mode: "tailor" as const,
    template: null,
    isByo: false,
    monthToDateSpend: 0,
    budgetCap: 5,
    dailyLimit: 5,
    githubRepo: "acme/jobify",
    githubToken: "gh-secret-token",
    fetchImpl: vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

describe("dispatchTailor", () => {
  it("returns not_configured when GitHub env vars are missing, without calling fetch or the admin client", async () => {
    const { admin } = fakeAdmin();
    const fetchImpl = vi.fn();
    const result = await dispatchTailor(
      baseDeps({ admin: admin as never, githubRepo: undefined, fetchImpl: fetchImpl as never })
    );
    expect(result).toEqual({ kind: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("returns budget_exceeded when pool spend >= cap and the caller is not BYO", async () => {
    const result = await dispatchTailor(baseDeps({ isByo: false, monthToDateSpend: 5, budgetCap: 5 }));
    expect(result).toEqual({ kind: "budget_exceeded" });
  });

  it("skips the budget check when the caller is BYO, even if pool spend >= cap", async () => {
    const result = await dispatchTailor(baseDeps({ isByo: true, monthToDateSpend: 5, budgetCap: 5 }));
    expect(result.kind).toBe("ok");
  });

  it("returns daily_limit when today's tailor-mode run count is already at the limit", async () => {
    const { admin } = fakeAdmin({ count: 5 });
    const result = await dispatchTailor(baseDeps({ admin: admin as never, dailyLimit: 5 }));
    expect(result).toEqual({ kind: "daily_limit", count: 5 });
  });

  it("dispatches when today's count is one below the limit", async () => {
    const { admin } = fakeAdmin({ count: 4 });
    const result = await dispatchTailor(baseDeps({ admin: admin as never, dailyLimit: 5 }));
    expect(result.kind).toBe("ok");
  });

  it("returns cooldown on a unique-violation insert error (an active run already exists for this posting)", async () => {
    const { admin, insert } = fakeAdmin({ insertResult: { data: null, error: { code: "23505", message: "dup" } } });
    const fetchImpl = vi.fn();
    const result = await dispatchTailor(baseDeps({ admin: admin as never, fetchImpl: fetchImpl as never }));
    expect(result).toEqual({ kind: "cooldown" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws on a non-unique-violation insert error instead of swallowing it", async () => {
    const { admin } = fakeAdmin({ insertResult: { data: null, error: { code: "42501", message: "rls denied" } } });
    await expect(dispatchTailor(baseDeps({ admin: admin as never }))).rejects.toEqual({
      code: "42501",
      message: "rls denied",
    });
  });

  it("dispatches with the exact documented GHA payload shape and never leaks the token in the result", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await dispatchTailor(
      baseDeps({ postingId: "posting-42", template: "swe-template", fetchImpl: fetchImpl as unknown as typeof fetch })
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/jobify/actions/workflows/hosted-tailor.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer gh-secret-token",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            user_id: "user-1",
            posting_id: "posting-42",
            run_id: "run-1",
            mode: "tailor",
            template: "swe-template",
          },
        }),
      }
    );
    expect(result).toEqual({ kind: "ok", runId: "run-1" });
    expect(JSON.stringify(result)).not.toContain("gh-secret-token");
  });

  it("sends an empty string for template when none was chosen (GitHub Actions string inputs can't be null)", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await dispatchTailor(baseDeps({ template: null, fetchImpl: fetchImpl as unknown as typeof fetch }));

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.inputs.template).toBe("");
  });

  it("on a non-204 dispatch response, flips the row to failed via the admin client and returns dispatch_failed without leaking the token", async () => {
    const { admin, update } = fakeAdmin();
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const result = await dispatchTailor(
      baseDeps({ admin: admin as never, fetchImpl: fetchImpl as unknown as typeof fetch })
    );

    expect(result).toEqual({ kind: "dispatch_failed", status: 500 });
    expect(update).toHaveBeenCalledWith({ status: "failed", error: "dispatch failed (status 500)" });
    expect(JSON.stringify(result)).not.toContain("gh-secret-token");
  });
});
