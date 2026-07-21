import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const pollRunsMock = vi.fn();
vi.mock("@/lib/tailor/pollRuns", () => ({ pollRuns: pollRunsMock }));

const { GET } = await import("./route");

function req(postingId?: string) {
  const url = postingId
    ? `http://localhost/api/tailor/runs?posting_id=${encodeURIComponent(postingId)}`
    : "http://localhost/api/tailor/runs";
  return new Request(url);
}

describe("GET /api/tailor/runs", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    createSupabaseAdminClientMock.mockClear();
    pollRunsMock.mockReset();
    pollRunsMock.mockResolvedValue({ runs: [] });
  });

  it("401s when not signed in — never constructs the service-role client or polls", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(req("posting-1"));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(pollRunsMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin — never polls", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await GET(req("posting-1"));
    expect(res.status).toBe(403);
    expect(pollRunsMock).not.toHaveBeenCalled();
  });

  it("400s when posting_id is missing — never polls (distinct from a valid-but-matchless posting_id)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(pollRunsMock).not.toHaveBeenCalled();
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns { runs: [] } for a valid posting_id with no matching rows, without erroring", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    pollRunsMock.mockResolvedValue({ runs: [] });
    const res = await GET(req("posting-no-runs"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [] });
  });

  it("scopes the poll to the signed-in user and the requested posting_id, with the 10-minute stale window", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    await GET(req("posting-42"));
    expect(pollRunsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", postingId: "posting-42", staleMinutes: 10 })
    );
    expect(createSupabaseAdminClientMock).toHaveBeenCalled();
  });

  it("returns the runs pollRuns produced, e.g. a reaped row", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    pollRunsMock.mockResolvedValue({
      runs: [{ id: "run-1", status: "failed", error: "runner never picked this up — try again" }],
    });
    const res = await GET(req("posting-1"));
    const body = await res.json();
    expect(body.runs[0]).toEqual({ id: "run-1", status: "failed", error: "runner never picked this up — try again" });
  });

  it("an admin without a claimed invite can still poll", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    const res = await GET(req("posting-1"));
    expect(res.status).toBe(200);
  });
});
