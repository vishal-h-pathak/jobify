import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSessionMock = vi.fn();
const createServerClientMock = vi.fn(() => ({
  auth: { exchangeCodeForSession: exchangeCodeForSessionMock },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const consumeAllowlistedEmailMock = vi.fn();
vi.mock("@/lib/db/allowlist", () => ({ consumeAllowlistedEmail: consumeAllowlistedEmailMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

const { GET } = await import("./route");

function req(pathAndQuery: string) {
  return new NextRequest(`https://jobify.example${pathAndQuery}`);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset();
    exchangeCodeForSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    hasClaimedInviteMock.mockReset();
    consumeAllowlistedEmailMock.mockReset();
    consumeAllowlistedEmailMock.mockResolvedValue(false);
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    createServerClientMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
  });

  it("redirects to /login with an error when there is no code", async () => {
    const res = await GET(req("/auth/callback"));
    expect(res.headers.get("location")).toBe("https://jobify.example/login?error=auth-failed");
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("redirects to /login with an error when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ data: { user: null }, error: new Error("bad code") });
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://jobify.example/login?error=auth-failed");
  });

  it("carries a same-origin next with its own querystring through untouched — code preserved", async () => {
    const next = encodeURIComponent("/invite?code=ABC-123");
    const res = await GET(req(`/auth/callback?code=abc&next=${next}`));
    expect(res.headers.get("location")).toBe("https://jobify.example/invite?code=ABC-123");
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("rejects a protocol-relative next (//evil.com) and falls back to the claim-based default", async () => {
    hasClaimedInviteMock.mockResolvedValue(false);
    const next = encodeURIComponent("//evil.com");
    const res = await GET(req(`/auth/callback?code=abc&next=${next}`));
    expect(res.headers.get("location")).toBe("https://jobify.example/invite");
  });

  it("rejects an absolute next (https://evil.com) and falls back to the claim-based default", async () => {
    hasClaimedInviteMock.mockResolvedValue(true);
    const next = encodeURIComponent("https://evil.com");
    const res = await GET(req(`/auth/callback?code=abc&next=${next}`));
    expect(res.headers.get("location")).toBe("https://jobify.example/feed");
  });

  it("defaults to /invite when there is no next, no claimed invite, and the email isn't allowlisted", async () => {
    hasClaimedInviteMock.mockResolvedValue(false);
    consumeAllowlistedEmailMock.mockResolvedValue(false);
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://jobify.example/invite");
    expect(consumeAllowlistedEmailMock).toHaveBeenCalledWith({ admin: true }, { id: "user-1" });
  });

  it("defaults to /feed when there is no next and the invite is already claimed", async () => {
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://jobify.example/feed");
    expect(consumeAllowlistedEmailMock).not.toHaveBeenCalled();
  });

  it("SGN-1: routes an allowlisted-and-consumed email straight to /onboarding, via a service-role client", async () => {
    hasClaimedInviteMock.mockResolvedValue(false);
    consumeAllowlistedEmailMock.mockResolvedValue(true);
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://jobify.example/onboarding");
    expect(createSupabaseAdminClientMock).toHaveBeenCalled();
    expect(consumeAllowlistedEmailMock).toHaveBeenCalledWith({ admin: true }, { id: "user-1" });
  });

  it("defaults admins to /admin when there is no next, without checking hasClaimedInvite or the allowlist", async () => {
    isAdminMock.mockReturnValue(true);
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://jobify.example/admin");
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
    expect(consumeAllowlistedEmailMock).not.toHaveBeenCalled();
  });

  it("an admin's own explicit safe next still wins over the /admin default", async () => {
    isAdminMock.mockReturnValue(true);
    const next = encodeURIComponent("/feed");
    const res = await GET(req(`/auth/callback?code=abc&next=${next}`));
    expect(res.headers.get("location")).toBe("https://jobify.example/feed");
  });
});
