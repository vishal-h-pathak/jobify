import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const adminClient = { marker: "admin-client" };
const createSupabaseAdminClientMock = vi.fn(() => adminClient);
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const buildReadyListMock = vi.fn();
vi.mock("@/lib/submit/readyList", () => ({ buildReadyList: buildReadyListMock }));

const { GET } = await import("./route");

function req() {
  return new Request("http://localhost/api/submit/ready");
}

describe("GET /api/submit/ready", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    createSupabaseAdminClientMock.mockClear();
    buildReadyListMock.mockReset();
  });

  it("401s when not signed in — never calls buildReadyList", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(buildReadyListMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin — never calls buildReadyList", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(buildReadyListMock).not.toHaveBeenCalled();
  });

  it("an admin without a claimed invite can still hit the route", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    buildReadyListMock.mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("delegates to buildReadyList with the admin client and the authed user's id", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(true);
    buildReadyListMock.mockResolvedValue([]);

    await GET();

    expect(buildReadyListMock).toHaveBeenCalledWith(adminClient, "user-1");
  });

  it("200s with the list body", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(true);
    const list = [{ posting_id: "posting-1", title: "Engineer", company: "Acme", application_url: "https://acme.example/apply" }];
    buildReadyListMock.mockResolvedValue(list);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(list);
  });

  it("200s with an empty array when there's nothing ready", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(true);
    buildReadyListMock.mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
