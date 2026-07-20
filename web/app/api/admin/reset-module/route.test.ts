import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminGate } from "@/lib/admin/requireAdmin";
import type { ResetModuleResult } from "@/lib/admin/resetModule";

const callOrder: string[] = [];

const requireAdminMock = vi.fn<() => Promise<AdminGate>>(async () => {
  callOrder.push("requireAdmin");
  return { ok: true, user: { id: "admin-1" } as never, supabase: {} as never };
});
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => {
  callOrder.push("createSupabaseAdminClient");
  return { admin: true };
});
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const resetUserModuleMock = vi.fn<(..._args: unknown[]) => Promise<ResetModuleResult>>(async () => ({ kind: "ok" }));
vi.mock("@/lib/admin/resetModule", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/resetModule")>("@/lib/admin/resetModule");
  return { resetUserModule: resetUserModuleMock, RESETTABLE_MODULE_KEYS: actual.RESETTABLE_MODULE_KEYS };
});

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/reset-module", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/reset-module", () => {
  beforeEach(() => {
    callOrder.length = 0;
    requireAdminMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
    resetUserModuleMock.mockClear();
    resetUserModuleMock.mockResolvedValue({ kind: "ok" });
  });

  it("401s when signed out — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    const res = await POST(jsonRequest({ userId: "user-1", module: "mirror" }));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(resetUserModuleMock).not.toHaveBeenCalled();
  });

  it("404s when signed in but not an admin — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const res = await POST(jsonRequest({ userId: "user-1", module: "mirror" }));
    expect(res.status).toBe(404);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(resetUserModuleMock).not.toHaveBeenCalled();
  });

  it("400s when userId is missing", async () => {
    const res = await POST(jsonRequest({ module: "mirror" }));
    expect(res.status).toBe(400);
    expect(resetUserModuleMock).not.toHaveBeenCalled();
  });

  it("400s on a module value that isn't a real ModuleKey — never trusts client input straight into a DB write", async () => {
    const res = await POST(jsonRequest({ userId: "user-1", module: "not-a-real-module" }));
    expect(res.status).toBe(400);
    expect(resetUserModuleMock).not.toHaveBeenCalled();
  });

  it("constructs the service-role client only AFTER the admin gate passes, then calls resetUserModule", async () => {
    const res = await POST(jsonRequest({ userId: "user-1", module: "mirror" }));
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["requireAdmin", "createSupabaseAdminClient"]);
    expect(resetUserModuleMock).toHaveBeenCalledWith(expect.anything(), "user-1", "mirror");
    const body = await res.json();
    expect(body).toEqual({ ok: true, changed: true });
  });

  it("404s when the target user has no onboarding session", async () => {
    resetUserModuleMock.mockResolvedValueOnce({ kind: "no_session" });
    const res = await POST(jsonRequest({ userId: "user-1", module: "mirror" }));
    expect(res.status).toBe(404);
  });

  it("200s with changed:false when the module was never completed (no-op)", async () => {
    resetUserModuleMock.mockResolvedValueOnce({ kind: "not_completed" });
    const res = await POST(jsonRequest({ userId: "user-1", module: "mirror" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, changed: false });
  });
});
