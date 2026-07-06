import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminGate } from "@/lib/admin/requireAdmin";

const callOrder: string[] = [];

const requireAdminMock = vi.fn<() => Promise<AdminGate>>();
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => {
  callOrder.push("createSupabaseAdminClient");
  return { admin: true };
});
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const getUserProfileReviewMock = vi.fn(async () => ({
  extracted: { anchor: { current_title: "Engineer" } },
  doc: { "cv.md": "hello" },
  validationStatus: { status: "valid", errors: [] },
}));
vi.mock("@/lib/admin/profileReview", () => ({ getUserProfileReview: getUserProfileReviewMock }));

const { GET } = await import("./route");

function req(userId?: string) {
  const url = userId
    ? `http://localhost/api/admin/profile-review?userId=${encodeURIComponent(userId)}`
    : "http://localhost/api/admin/profile-review";
  return new Request(url);
}

describe("GET /api/admin/profile-review", () => {
  beforeEach(() => {
    callOrder.length = 0;
    requireAdminMock.mockReset();
    requireAdminMock.mockImplementation(async () => {
      callOrder.push("requireAdmin");
      return { ok: true, user: { id: "admin-1" } as never, supabase: {} as never };
    });
    createSupabaseAdminClientMock.mockClear();
    getUserProfileReviewMock.mockClear();
  });

  it("401s when signed out — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    const res = await GET(req("user-1"));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(getUserProfileReviewMock).not.toHaveBeenCalled();
  });

  it("403s when signed in but not an admin — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const res = await GET(req("user-1"));
    expect(res.status).toBe(403);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(getUserProfileReviewMock).not.toHaveBeenCalled();
  });

  it("400s when userId is missing — never constructs the service-role client", async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("constructs the service-role client only AFTER the admin gate passes", async () => {
    const res = await GET(req("user-1"));
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["requireAdmin", "createSupabaseAdminClient"]);
  });

  it("returns the review payload for the requested user (renders extracted + doc files from a fake)", async () => {
    const res = await GET(req("user-1"));
    const body = await res.json();
    expect(body).toEqual({
      extracted: { anchor: { current_title: "Engineer" } },
      doc: { "cv.md": "hello" },
      validationStatus: { status: "valid", errors: [] },
    });
    expect(getUserProfileReviewMock).toHaveBeenCalledWith(expect.anything(), "user-1");
  });
});
