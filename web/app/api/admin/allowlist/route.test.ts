import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminGate } from "@/lib/admin/requireAdmin";

const requireAdminMock = vi.fn<() => Promise<AdminGate>>(async () => ({
  ok: true,
  user: { id: "admin-1" } as never,
  supabase: {} as never,
}));
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const addAllowlistedEmailMock = vi.fn(async () => undefined);
const removeAllowlistedEmailMock = vi.fn(async () => undefined);
vi.mock("@/lib/admin/allowlist", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/allowlist")>("@/lib/admin/allowlist");
  return {
    ...actual,
    addAllowlistedEmail: addAllowlistedEmailMock,
    removeAllowlistedEmail: removeAllowlistedEmailMock,
  };
});

const { POST, DELETE } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/allowlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/allowlist", () => {
  beforeEach(() => {
    requireAdminMock.mockClear();
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never, supabase: {} as never });
    createSupabaseAdminClientMock.mockClear();
    addAllowlistedEmailMock.mockClear();
    removeAllowlistedEmailMock.mockClear();
  });

  it("401s when signed out — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    const res = await POST(jsonRequest({ email: "friend@example.com" }));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("403s when signed in but not an admin — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const res = await POST(jsonRequest({ email: "friend@example.com" }));
    expect(res.status).toBe(403);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("400s on a shape-invalid email — never constructs the service-role client", async () => {
    const res = await POST(jsonRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(addAllowlistedEmailMock).not.toHaveBeenCalled();
  });

  it("lowercases the email and passes an optional note through", async () => {
    const res = await POST(jsonRequest({ email: "Friend@Example.COM", note: "  Alex  " }));
    expect(res.status).toBe(200);
    expect(addAllowlistedEmailMock).toHaveBeenCalledWith({ admin: true }, "friend@example.com", "Alex");
  });

  it("passes null when no note is given", async () => {
    const res = await POST(jsonRequest({ email: "friend@example.com" }));
    expect(res.status).toBe(200);
    expect(addAllowlistedEmailMock).toHaveBeenCalledWith({ admin: true }, "friend@example.com", null);
  });
});

describe("DELETE /api/admin/allowlist", () => {
  beforeEach(() => {
    requireAdminMock.mockClear();
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never, supabase: {} as never });
    createSupabaseAdminClientMock.mockClear();
    removeAllowlistedEmailMock.mockClear();
  });

  it("401s when signed out — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    const res = await DELETE(jsonRequest({ email: "friend@example.com" }));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("403s when signed in but not an admin", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const res = await DELETE(jsonRequest({ email: "friend@example.com" }));
    expect(res.status).toBe(403);
  });

  it("400s when no email is given", async () => {
    const res = await DELETE(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(removeAllowlistedEmailMock).not.toHaveBeenCalled();
  });

  it("removes the lowercased email", async () => {
    const res = await DELETE(jsonRequest({ email: "Friend@Example.COM" }));
    expect(res.status).toBe(200);
    expect(removeAllowlistedEmailMock).toHaveBeenCalledWith({ admin: true }, "friend@example.com");
  });
});
