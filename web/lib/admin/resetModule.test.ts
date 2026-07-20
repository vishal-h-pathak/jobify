import { describe, expect, it } from "vitest";
import { resetUserModule } from "./resetModule";

function fakeAdmin(session: { data: unknown; error: unknown }) {
  const updateCalls: Array<{ payload: unknown }> = [];
  const readChain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    readChain[method] = () => readChain;
  }
  readChain.then = (resolve: (v: unknown) => void) => resolve(session);

  const admin = {
    from: () => ({
      ...readChain,
      update: (payload: unknown) => {
        updateCalls.push({ payload });
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  };
  return { admin: admin as never, updateCalls };
}

describe("resetUserModule", () => {
  it("returns no_session when the user has no onboarding_sessions row", async () => {
    const { admin } = fakeAdmin({ data: null, error: null });
    const result = await resetUserModule(admin as never, "user-1", "mirror");
    expect(result).toEqual({ kind: "no_session" });
  });

  it("returns not_completed (no-op) when the module was never marked complete", async () => {
    const { admin, updateCalls } = fakeAdmin({ data: { modules: { anchor: { completed_at: "x", receipt: "r" } } }, error: null });
    const result = await resetUserModule(admin as never, "user-1", "mirror");
    expect(result).toEqual({ kind: "not_completed" });
    expect(updateCalls).toHaveLength(0);
  });

  it("clears exactly the named module's completion entry, leaving every other module untouched", async () => {
    const { admin, updateCalls } = fakeAdmin({
      data: {
        modules: {
          anchor: { completed_at: "2026-07-19T00:00:00Z", receipt: "Staff Engineer" },
          mirror: { completed_at: "2026-07-20T00:00:00Z", receipt: "3 quotes" },
        },
      },
      error: null,
    });

    const result = await resetUserModule(admin as never, "user-1", "mirror");

    expect(result).toEqual({ kind: "ok" });
    expect(updateCalls).toHaveLength(1);
    const payload = updateCalls[0].payload as { modules: Record<string, unknown> };
    expect(payload.modules.mirror).toBeUndefined();
    expect(payload.modules.anchor).toEqual({ completed_at: "2026-07-19T00:00:00Z", receipt: "Staff Engineer" });
  });
});
