import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSessionMock = vi.fn();
const createServerClientMock = vi.fn(() => ({
  auth: { exchangeCodeForSession: exchangeCodeForSessionMock },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

const { GET } = await import("./route");

function req(pathAndQuery: string) {
  return new NextRequest(`https://jobify.example${pathAndQuery}`);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset();
    hasClaimedInviteMock.mockReset();
    createServerClientMock.mockClear();
  });

  it("redirects to /login with an error when there is no code", async () => {
    const res = await GET(req("/auth/callback"));
    expect(res.headers.get("location")).toBe("https://jobify.example/login?error=auth-failed");
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("redirects to /login with an error when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: new Error("bad code") });
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://jobify.example/login?error=auth-failed");
  });

  it("carries a same-origin next with its own querystring through untouched — code preserved", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    const next = encodeURIComponent("/invite?code=ABC-123");
    const res = await GET(req(`/auth/callback?code=abc&next=${next}`));
    expect(res.headers.get("location")).toBe("https://jobify.example/invite?code=ABC-123");
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("rejects a protocol-relative next (//evil.com) and falls back to the claim-based default", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    hasClaimedInviteMock.mockResolvedValue(false);
    const next = encodeURIComponent("//evil.com");
    const res = await GET(req(`/auth/callback?code=abc&next=${next}`));
    expect(res.headers.get("location")).toBe("https://jobify.example/invite");
  });

  it("rejects an absolute next (https://evil.com) and falls back to the claim-based default", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    hasClaimedInviteMock.mockResolvedValue(true);
    const next = encodeURIComponent("https://evil.com");
    const res = await GET(req(`/auth/callback?code=abc&next=${next}`));
    expect(res.headers.get("location")).toBe("https://jobify.example/feed");
  });

  it("defaults to /invite when there is no next and no claimed invite", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://jobify.example/invite");
  });

  it("defaults to /feed when there is no next and the invite is already claimed", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://jobify.example/feed");
  });
});
