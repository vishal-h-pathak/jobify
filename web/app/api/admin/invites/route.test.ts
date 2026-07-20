import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminGate } from "@/lib/admin/requireAdmin";

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

const mintInvitesMock = vi.fn(async (_admin: unknown, n: number) =>
  Array.from({ length: n }, (_, i) => `code${i}`.padEnd(12, "0"))
);
vi.mock("@/lib/admin/invites", () => ({ mintInvites: mintInvitesMock }));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/invites", () => {
  beforeEach(() => {
    callOrder.length = 0;
    requireAdminMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
    mintInvitesMock.mockClear();
  });

  it("401s when signed out — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    const res = await POST(jsonRequest({ n: 3 }));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(mintInvitesMock).not.toHaveBeenCalled();
  });

  it("404s when signed in but not an admin — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const res = await POST(jsonRequest({ n: 3 }));
    expect(res.status).toBe(404);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(mintInvitesMock).not.toHaveBeenCalled();
  });

  it("400s on a non-positive-integer n — never constructs the service-role client", async () => {
    const res = await POST(jsonRequest({ n: 0 }));
    expect(res.status).toBe(400);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("constructs the service-role client only AFTER the admin gate passes", async () => {
    const res = await POST(jsonRequest({ n: 3 }));
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["requireAdmin", "createSupabaseAdminClient"]);
  });

  it("respects N and returns the minted codes", async () => {
    const res = await POST(jsonRequest({ n: 5 }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.codes).toHaveLength(5);
    expect(mintInvitesMock).toHaveBeenCalledWith(expect.anything(), 5);
  });
});
