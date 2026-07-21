import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminGate } from "@/lib/admin/requireAdmin";
import type { SetDormantResult } from "@/lib/admin/sourceHealth";

const requireAdminMock = vi.fn<() => Promise<AdminGate>>(async () => ({
  ok: true, user: { id: "admin-1" } as never, supabase: {} as never,
}));
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const setBoardDormantMock = vi.fn<(..._args: unknown[]) => Promise<SetDormantResult>>(async () => ({ kind: "ok" }));
vi.mock("@/lib/admin/sourceHealth", () => ({ setBoardDormant: setBoardDormantMock }));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/sources/dormant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/sources/dormant", () => {
  beforeEach(() => {
    requireAdminMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
    setBoardDormantMock.mockClear();
    setBoardDormantMock.mockResolvedValue({ kind: "ok" });
  });

  it("401s when signed out — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    const res = await POST(jsonRequest({ boardId: "b1" }));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("404s when signed in but not an admin", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const res = await POST(jsonRequest({ boardId: "b1" }));
    expect(res.status).toBe(404);
  });

  it("400s when boardId is missing", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(setBoardDormantMock).not.toHaveBeenCalled();
  });

  it("sets dormant and returns ok", async () => {
    const res = await POST(jsonRequest({ boardId: "b1" }));
    expect(res.status).toBe(200);
    expect(setBoardDormantMock).toHaveBeenCalledWith(expect.anything(), "b1");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404s when the board doesn't exist", async () => {
    setBoardDormantMock.mockResolvedValueOnce({ kind: "not_found" });
    const res = await POST(jsonRequest({ boardId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("409s when the board is already dormant or dead", async () => {
    setBoardDormantMock.mockResolvedValueOnce({ kind: "not_active" });
    const res = await POST(jsonRequest({ boardId: "b1" }));
    expect(res.status).toBe(409);
  });
});
