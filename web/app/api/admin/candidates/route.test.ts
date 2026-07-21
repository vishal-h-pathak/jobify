import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminGate } from "@/lib/admin/requireAdmin";
import type { CandidateBoardView } from "@/lib/admin/candidates";

const requireAdminMock = vi.fn<() => Promise<AdminGate>>(async () => ({
  ok: true, user: { id: "admin-1" } as never, supabase: {} as never,
}));
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const listPendingCandidatesMock = vi.fn<() => Promise<CandidateBoardView[]>>(async () => []);
const listRecentAutoAdmittedCandidatesMock = vi.fn<() => Promise<CandidateBoardView[]>>(async () => []);
vi.mock("@/lib/admin/candidates", () => ({
  listPendingCandidates: listPendingCandidatesMock,
  listRecentAutoAdmittedCandidates: listRecentAutoAdmittedCandidatesMock,
}));

const { GET } = await import("./route");

describe("GET /api/admin/candidates", () => {
  beforeEach(() => {
    requireAdminMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
    listPendingCandidatesMock.mockClear();
    listRecentAutoAdmittedCandidatesMock.mockClear();
    listPendingCandidatesMock.mockResolvedValue([]);
    listRecentAutoAdmittedCandidatesMock.mockResolvedValue([]);
  });

  it("401s when signed out — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("404s when signed in but not an admin", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const res = await GET();
    expect(res.status).toBe(404);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns pending and recentAutoAdmitted for an admin", async () => {
    const pendingRow = { id: "c1" } as CandidateBoardView;
    const admittedRow = { id: "c2" } as CandidateBoardView;
    listPendingCandidatesMock.mockResolvedValueOnce([pendingRow]);
    listRecentAutoAdmittedCandidatesMock.mockResolvedValueOnce([admittedRow]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ pending: [pendingRow], recentAutoAdmitted: [admittedRow] });
  });
});
