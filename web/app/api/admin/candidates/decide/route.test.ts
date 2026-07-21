import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdminGate } from "@/lib/admin/requireAdmin";
import type { ApproveResult, RejectResult } from "@/lib/admin/candidates";

const requireAdminMock = vi.fn<() => Promise<AdminGate>>(async () => ({
  ok: true, user: { id: "admin-1" } as never, supabase: {} as never,
}));
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const approveCandidateMock = vi.fn<(..._args: unknown[]) => Promise<ApproveResult>>(async () => ({ kind: "ok" }));
const rejectCandidateMock = vi.fn<(..._args: unknown[]) => Promise<RejectResult>>(async () => ({ kind: "ok" }));
vi.mock("@/lib/admin/candidates", () => ({
  approveCandidate: approveCandidateMock,
  rejectCandidate: rejectCandidateMock,
}));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/candidates/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/candidates/decide", () => {
  beforeEach(() => {
    requireAdminMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
    approveCandidateMock.mockClear();
    rejectCandidateMock.mockClear();
    approveCandidateMock.mockResolvedValue({ kind: "ok" });
    rejectCandidateMock.mockResolvedValue({ kind: "ok" });
  });

  it("401s when signed out — never constructs the service-role client", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    const res = await POST(jsonRequest({ candidateId: "c1", decision: "approve" }));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("404s when signed in but not an admin", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const res = await POST(jsonRequest({ candidateId: "c1", decision: "approve" }));
    expect(res.status).toBe(404);
  });

  it("400s when candidateId is missing", async () => {
    const res = await POST(jsonRequest({ decision: "approve" }));
    expect(res.status).toBe(400);
    expect(approveCandidateMock).not.toHaveBeenCalled();
  });

  it("400s on an invalid decision value — never trusts client input straight through", async () => {
    const res = await POST(jsonRequest({ candidateId: "c1", decision: "delete" }));
    expect(res.status).toBe(400);
    expect(approveCandidateMock).not.toHaveBeenCalled();
    expect(rejectCandidateMock).not.toHaveBeenCalled();
  });

  it("approves and returns ok", async () => {
    const res = await POST(jsonRequest({ candidateId: "c1", decision: "approve" }));
    expect(res.status).toBe(200);
    expect(approveCandidateMock).toHaveBeenCalledWith(expect.anything(), "c1");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404s when approving a candidate that doesn't exist", async () => {
    approveCandidateMock.mockResolvedValueOnce({ kind: "not_found" });
    const res = await POST(jsonRequest({ candidateId: "missing", decision: "approve" }));
    expect(res.status).toBe(404);
  });

  it("409s when approving an already-decided candidate", async () => {
    approveCandidateMock.mockResolvedValueOnce({ kind: "not_pending" });
    const res = await POST(jsonRequest({ candidateId: "c1", decision: "approve" }));
    expect(res.status).toBe(409);
  });

  it("422s when approving a candidate with no probed board", async () => {
    approveCandidateMock.mockResolvedValueOnce({ kind: "missing_board_info" });
    const res = await POST(jsonRequest({ candidateId: "c1", decision: "approve" }));
    expect(res.status).toBe(422);
  });

  it("rejects with the given reason and returns ok", async () => {
    const res = await POST(jsonRequest({ candidateId: "c1", decision: "reject", reason: "not real" }));
    expect(res.status).toBe(200);
    expect(rejectCandidateMock).toHaveBeenCalledWith(expect.anything(), "c1", "not real");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects with an empty reason when none is given", async () => {
    await POST(jsonRequest({ candidateId: "c1", decision: "reject" }));
    expect(rejectCandidateMock).toHaveBeenCalledWith(expect.anything(), "c1", "");
  });

  it("404s when rejecting a candidate that doesn't exist", async () => {
    rejectCandidateMock.mockResolvedValueOnce({ kind: "not_found" });
    const res = await POST(jsonRequest({ candidateId: "missing", decision: "reject" }));
    expect(res.status).toBe(404);
  });
});
