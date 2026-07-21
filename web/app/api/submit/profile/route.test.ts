import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const adminClient = {};
const createSupabaseAdminClientMock = vi.fn(() => adminClient);
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const loadApplicationProfileMock = vi.fn();
const saveApplicationProfileMock = vi.fn();
vi.mock("@/lib/submit/applicationProfile", () => ({
  loadApplicationProfile: loadApplicationProfileMock,
  saveApplicationProfile: saveApplicationProfileMock,
}));

const { GET, POST } = await import("./route");

const ALEX_QUINN_PROFILE = {
  contact: { phone: "555-0100", location: "Remote" },
  authorization: { work_authorized: "yes" as const },
  logistics: {},
  self_id: {},
  updated_at: "2026-07-18T00:00:00.000Z",
};

function postReq(body: unknown) {
  return new Request("http://localhost/api/submit/profile", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function getReq() {
  return new Request("http://localhost/api/submit/profile");
}

describe("POST /api/submit/profile", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    createSupabaseAdminClientMock.mockClear();
    loadApplicationProfileMock.mockReset();
    saveApplicationProfileMock.mockReset();
  });

  it("401s when not signed in — never saves", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(postReq(ALEX_QUINN_PROFILE));
    expect(res.status).toBe(401);
    expect(saveApplicationProfileMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin — never saves", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await POST(postReq(ALEX_QUINN_PROFILE));
    expect(res.status).toBe(403);
    expect(saveApplicationProfileMock).not.toHaveBeenCalled();
  });

  it("204s with no body on a successful save, via the admin client", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    saveApplicationProfileMock.mockResolvedValue(ALEX_QUINN_PROFILE);

    const res = await POST(postReq(ALEX_QUINN_PROFILE));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(saveApplicationProfileMock).toHaveBeenCalledWith(adminClient, "user-1", ALEX_QUINN_PROFILE);
  });

  it("an admin without a claimed invite can still save", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    saveApplicationProfileMock.mockResolvedValue(ALEX_QUINN_PROFILE);

    const res = await POST(postReq(ALEX_QUINN_PROFILE));
    expect(res.status).toBe(204);
  });

  it("passes null to saveApplicationProfile when the body fails to parse as JSON", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    saveApplicationProfileMock.mockResolvedValue(ALEX_QUINN_PROFILE);

    const badReq = new Request("http://localhost/api/submit/profile", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(204);
    expect(saveApplicationProfileMock).toHaveBeenCalledWith(adminClient, "user-1", null);
  });
});

describe("GET /api/submit/profile", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    createSupabaseAdminClientMock.mockClear();
    loadApplicationProfileMock.mockReset();
    saveApplicationProfileMock.mockReset();
  });

  it("401s when not signed in — never loads", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(loadApplicationProfileMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin — never loads", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(loadApplicationProfileMock).not.toHaveBeenCalled();
  });

  it("404s before any save has ever happened", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    loadApplicationProfileMock.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("200s with the profile after a save", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    loadApplicationProfileMock.mockResolvedValue(ALEX_QUINN_PROFILE);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ALEX_QUINN_PROFILE);
    expect(loadApplicationProfileMock).toHaveBeenCalledWith(adminClient, "user-1");
  });

  it("an admin without a claimed invite can still load their own profile", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    loadApplicationProfileMock.mockResolvedValue(ALEX_QUINN_PROFILE);

    const res = await GET();
    expect(res.status).toBe(200);
  });
});
