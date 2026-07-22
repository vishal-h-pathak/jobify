import { describe, expect, it, vi } from "vitest";
import { getOrCreateSession } from "./onboardingSession";
import type { User } from "@supabase/supabase-js";

function fakeSupabase(opts: { existing: unknown; created: unknown }) {
  const insertSpy = vi.fn();
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: opts.existing, error: null });
  chain.insert = (payload: unknown) => {
    insertSpy(payload);
    return chain;
  };
  chain.single = () => Promise.resolve({ data: opts.created, error: null });
  return { supabase: { from: () => chain } as never, insertSpy };
}

function fakeUser(userMetadata: Record<string, unknown>): User {
  return { user_metadata: userMetadata } as unknown as User;
}

describe("getOrCreateSession", () => {
  it("returns the existing row and never inserts when one is already there", async () => {
    const { supabase, insertSpy } = fakeSupabase({ existing: { user_id: "u1" }, created: null });
    const result = await getOrCreateSession(supabase, "u1", fakeUser({ full_name: "Alex Quinn" }));
    expect(result).toEqual({ user_id: "u1" });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("Fix D (session 58): seeds identity.name from user_metadata.full_name on first creation", async () => {
    const { supabase, insertSpy } = fakeSupabase({ existing: null, created: { user_id: "u1" } });
    await getOrCreateSession(supabase, "u1", fakeUser({ full_name: "Alex Quinn" }));
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        extracted: expect.objectContaining({ identity: expect.objectContaining({ name: "Alex Quinn" }) }),
      })
    );
  });

  it("falls back to user_metadata.name when full_name is absent", async () => {
    const { supabase, insertSpy } = fakeSupabase({ existing: null, created: { user_id: "u1" } });
    await getOrCreateSession(supabase, "u1", fakeUser({ name: "Alex Quinn" }));
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ extracted: expect.objectContaining({ identity: expect.objectContaining({ name: "Alex Quinn" }) }) })
    );
  });

  it("omits extracted entirely when neither full_name nor name is present — never seeds a blank/garbage name", async () => {
    const { supabase, insertSpy } = fakeSupabase({ existing: null, created: { user_id: "u1" } });
    await getOrCreateSession(supabase, "u1", fakeUser({ avatar_url: "https://example.com/x.png" }));
    expect(insertSpy).toHaveBeenCalledWith({ user_id: "u1" });
  });

  it("omits extracted entirely when no authUser is passed at all", async () => {
    const { supabase, insertSpy } = fakeSupabase({ existing: null, created: { user_id: "u1" } });
    await getOrCreateSession(supabase, "u1");
    expect(insertSpy).toHaveBeenCalledWith({ user_id: "u1" });
  });
});
