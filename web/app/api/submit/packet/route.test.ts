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

const buildSubmitPacketMock = vi.fn();
vi.mock("@/lib/submit/packet", () => ({ buildSubmitPacket: buildSubmitPacketMock }));

const { GET } = await import("./route");

function req(query?: string) {
  return new Request(`http://localhost/api/submit/packet${query ? `?${query}` : ""}`);
}

describe("GET /api/submit/packet", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    createSupabaseAdminClientMock.mockClear();
    buildSubmitPacketMock.mockReset();
  });

  it("401s when not signed in — never calls buildSubmitPacket", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(req("posting_id=posting-1"));
    expect(res.status).toBe(401);
    expect(buildSubmitPacketMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin — never calls buildSubmitPacket", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await GET(req("posting_id=posting-1"));
    expect(res.status).toBe(403);
    expect(buildSubmitPacketMock).not.toHaveBeenCalled();
  });

  it("400s when posting_id is missing — never calls buildSubmitPacket", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "posting_id required" });
    expect(buildSubmitPacketMock).not.toHaveBeenCalled();
  });

  it("delegates to buildSubmitPacket with the authed user's id/email and the posting_id param", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(true);
    buildSubmitPacketMock.mockResolvedValue({ ok: true, packet: { posting: { id: "posting-1" } } });

    await GET(req("posting_id=posting-1"));

    expect(buildSubmitPacketMock).toHaveBeenCalledWith(adminClient, "user-1", "alex@example.com", "posting-1");
  });

  it("falls back to an empty-string email when the authed user has none", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: undefined } } });
    hasAccessMock.mockResolvedValue(true);
    buildSubmitPacketMock.mockResolvedValue({ ok: true, packet: { posting: { id: "posting-1" } } });

    await GET(req("posting_id=posting-1"));

    expect(buildSubmitPacketMock).toHaveBeenCalledWith(adminClient, "user-1", "", "posting-1");
  });

  it("maps the ok:true branch to 200 with the packet body", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(true);
    const packet = { posting: { id: "posting-1" }, meta: { tailor_run_id: "run-1" } };
    buildSubmitPacketMock.mockResolvedValue({ ok: true, packet });

    const res = await GET(req("posting_id=posting-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(packet);
  });

  it("maps the 409 no_application_profile branch", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(true);
    buildSubmitPacketMock.mockResolvedValue({ ok: false, status: 409, error: "no_application_profile" });

    const res = await GET(req("posting_id=posting-1"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_application_profile" });
  });

  it("maps the 404 no_materials branch", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex@example.com" } } });
    hasAccessMock.mockResolvedValue(true);
    buildSubmitPacketMock.mockResolvedValue({ ok: false, status: 404, error: "no_materials" });

    const res = await GET(req("posting_id=posting-1"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_materials" });
  });

  it("an admin without a claimed invite can still hit the route", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    buildSubmitPacketMock.mockResolvedValue({ ok: true, packet: {} });

    const res = await GET(req("posting_id=posting-1"));

    expect(res.status).toBe(200);
  });
});
