import { describe, expect, it, vi, beforeEach } from "vitest";

const setSessionMock = vi.fn();
const refreshSessionMock = vi.fn();
const createClientMock = vi.fn(() => ({ auth: { setSession: setSessionMock, refreshSession: refreshSessionMock } }));

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const { createSupabaseAuthClient } = await import("./supabaseAuthClient");

describe("createSupabaseAuthClient", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    setSessionMock.mockReset();
    refreshSessionMock.mockReset();
  });

  it("configures the client with persistSession/autoRefreshToken both off", () => {
    createSupabaseAuthClient("https://x.supabase.co", "anon-key");
    expect(createClientMock).toHaveBeenCalledWith(
      "https://x.supabase.co",
      "anon-key",
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }) })
    );
  });

  it("setSession maps a successful response to {session, error: null}", async () => {
    setSessionMock.mockResolvedValue({
      data: { session: { access_token: "a1", refresh_token: "r1", extra_field: "ignored" } },
      error: null,
    });
    const client = createSupabaseAuthClient("https://x.supabase.co", "anon-key");

    const result = await client.setSession({ access_token: "old", refresh_token: "old" });

    expect(result).toEqual({ session: { access_token: "a1", refresh_token: "r1" }, error: null });
  });

  it("setSession maps an error response to {session: null, error: message}", async () => {
    setSessionMock.mockResolvedValue({ data: { session: null }, error: { message: "invalid token" } });
    const client = createSupabaseAuthClient("https://x.supabase.co", "anon-key");

    expect(await client.setSession({ access_token: "bad", refresh_token: "bad" })).toEqual({
      session: null,
      error: "invalid token",
    });
  });

  it("refreshSession maps a successful response to {session, error: null}", async () => {
    refreshSessionMock.mockResolvedValue({
      data: { session: { access_token: "a2", refresh_token: "r2" } },
      error: null,
    });
    const client = createSupabaseAuthClient("https://x.supabase.co", "anon-key");

    const result = await client.refreshSession("r1");

    expect(refreshSessionMock).toHaveBeenCalledWith({ refresh_token: "r1" });
    expect(result).toEqual({ session: { access_token: "a2", refresh_token: "r2" }, error: null });
  });

  it("refreshSession maps an error response to {session: null, error: message}", async () => {
    refreshSessionMock.mockResolvedValue({ data: { session: null }, error: { message: "expired" } });
    const client = createSupabaseAuthClient("https://x.supabase.co", "anon-key");

    expect(await client.refreshSession("stale")).toEqual({ session: null, error: "expired" });
  });
});
