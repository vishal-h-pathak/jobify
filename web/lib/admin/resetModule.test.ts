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
    const payload = updateCalls[0].payload as { modules: Record<string, unknown>; extracted?: Record<string, unknown> };
    expect(payload.modules.mirror).toBeUndefined();
    expect(payload.modules.anchor).toEqual({ completed_at: "2026-07-19T00:00:00Z", receipt: "Staff Engineer" });
    expect(payload.extracted).toBeUndefined();
  });

  // INT2-B (session-prompts/56_int2_deck.md §4): resetting "reactions" must
  // also clear the generated deck, or the module reports incomplete but
  // instantly re-serves the same stale scenarios instead of regenerating.
  it("clears extracted.reaction_deck when resetting reactions, leaving the rest of extracted untouched", async () => {
    const { admin, updateCalls } = fakeAdmin({
      data: {
        modules: { reactions: { completed_at: "2026-07-21T00:00:00Z", receipt: "6 reactions" } },
        extracted: { reaction_deck: [{ id: "s1" }], reactions: [{ posting_id: "s1", reaction: "interested" }], anchor: { current_title: "Media Strategist" } },
      },
      error: null,
    });

    const result = await resetUserModule(admin as never, "user-1", "reactions");

    expect(result).toEqual({ kind: "ok" });
    const payload = updateCalls[0].payload as { modules: Record<string, unknown>; extracted: Record<string, unknown> };
    expect(payload.extracted.reaction_deck).toBeUndefined();
    expect(payload.extracted.reactions).toEqual([{ posting_id: "s1", reaction: "interested" }]);
    expect(payload.extracted.anchor).toEqual({ current_title: "Media Strategist" });
  });

  it("does not touch extracted when resetting a non-reactions module, even if reaction_deck is present", async () => {
    const { admin, updateCalls } = fakeAdmin({
      data: {
        modules: { mirror: { completed_at: "2026-07-20T00:00:00Z", receipt: "3 quotes" } },
        extracted: { reaction_deck: [{ id: "s1" }] },
      },
      error: null,
    });

    await resetUserModule(admin as never, "user-1", "mirror");

    const payload = updateCalls[0].payload as { extracted?: unknown };
    expect(payload.extracted).toBeUndefined();
  });
});
