import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const dispatchHuntMock = vi.fn();
vi.mock("@/lib/hunt/dispatchHunt", () => ({ dispatchHunt: dispatchHuntMock }));

const { POST } = await import("./route");

function jsonRequest(body: unknown = {}) {
  return new Request("http://localhost/api/hunt/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/hunt/run", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    createSupabaseAdminClientMock.mockClear();
    dispatchHuntMock.mockReset();
    dispatchHuntMock.mockResolvedValue({ kind: "ok", cooldownUntil: "2026-07-05T18:00:00.000Z" });
    vi.stubEnv("GITHUB_REPO", "acme/jobify");
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "gh-secret-token");
    vi.stubEnv("HUNT_COOLDOWN_HOURS", "6");
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest());
    expect(res.status).toBe(401);
    expect(dispatchHuntMock).not.toHaveBeenCalled();
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await POST(jsonRequest());
    expect(res.status).toBe(403);
    expect(dispatchHuntMock).not.toHaveBeenCalled();
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("a non-admin always targets themselves, ignoring a userId in the body", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    await POST(jsonRequest({ userId: "someone-else" }));
    expect(dispatchHuntMock).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: "user-1", bypassCooldown: false }));
  });

  it("an admin can target another user's hunt via userId, bypassing cooldown", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    await POST(jsonRequest({ userId: "user-2" }));
    expect(hasAccessMock).not.toHaveBeenCalled();
    expect(dispatchHuntMock).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: "user-2", bypassCooldown: true }));
  });

  it("an admin with no userId in the body targets themselves", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    await POST(jsonRequest());
    expect(dispatchHuntMock).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: "admin-1" }));
  });

  it("maps cooldown to 429 with cooldown_until", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    dispatchHuntMock.mockResolvedValue({ kind: "cooldown", cooldownUntil: "2026-07-05T14:00:00.000Z" });
    const res = await POST(jsonRequest());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.cooldown_until).toBe("2026-07-05T14:00:00.000Z");
  });

  it("maps not_configured to 503 and never leaks the token", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    dispatchHuntMock.mockResolvedValue({ kind: "not_configured" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(jsonRequest());
    expect(res.status).toBe(503);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("gh-secret-token");
    for (const call of errorSpy.mock.calls) {
      expect(call.join(" ")).not.toContain("gh-secret-token");
    }
    errorSpy.mockRestore();
  });

  it("maps dispatch_failed to 502", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    dispatchHuntMock.mockResolvedValue({ kind: "dispatch_failed", status: 401 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(jsonRequest());
    expect(res.status).toBe(502);
  });

  it("maps no_profile to 404 and invalid_profile to 422", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);

    dispatchHuntMock.mockResolvedValue({ kind: "no_profile" });
    expect((await POST(jsonRequest())).status).toBe(404);

    dispatchHuntMock.mockResolvedValue({ kind: "invalid_profile" });
    expect((await POST(jsonRequest())).status).toBe(422);
  });

  it("succeeds with ok + cooldown_until, and only constructs the service-role client after the gates pass", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(jsonRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, cooldown_until: "2026-07-05T18:00:00.000Z" });
    expect(createSupabaseAdminClientMock).toHaveBeenCalled();
  });
});
