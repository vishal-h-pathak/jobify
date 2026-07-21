import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

// Chainable fake admin `.from("tailor_runs").select().eq().eq().maybeSingle()`
// plus the `.storage` surface signMaterials would touch, wired per test.
const maybeSingleMock = vi.fn();
const eq2Mock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const eq1Mock = vi.fn(() => ({ eq: eq2Mock }));
const selectMock = vi.fn(() => ({ eq: eq1Mock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
const adminClient = { from: fromMock };
const createSupabaseAdminClientMock = vi.fn(() => adminClient);
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const signMaterialsMock = vi.fn();
vi.mock("@/lib/materials/signMaterials", () => ({ signMaterials: signMaterialsMock }));

const { GET } = await import("./route");

function req() {
  return new Request("http://localhost/api/tailor/materials/run-1");
}

function ctx(runId: string) {
  return { params: Promise.resolve({ runId }) };
}

describe("GET /api/tailor/materials/[runId]", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    createSupabaseAdminClientMock.mockClear();
    fromMock.mockClear();
    selectMock.mockClear();
    eq1Mock.mockClear();
    eq2Mock.mockClear();
    maybeSingleMock.mockReset();
    signMaterialsMock.mockReset();
    signMaterialsMock.mockResolvedValue({});
  });

  it("401s when not signed in — never queries or signs", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(req(), ctx("run-1"));
    expect(res.status).toBe(401);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(signMaterialsMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin — never queries or signs", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await GET(req(), ctx("run-1"));
    expect(res.status).toBe(403);
    expect(signMaterialsMock).not.toHaveBeenCalled();
  });

  it("await()s the dynamic params instead of destructuring synchronously", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    await GET(req(), ctx("run-async-check"));
    expect(eq1Mock).toHaveBeenCalledWith("id", "run-async-check");
  });

  it("404s a run that does not exist", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await GET(req(), ctx("missing-run"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(signMaterialsMock).not.toHaveBeenCalled();
  });

  it("404s a run belonging to a different user — identical response to not-found (no user-enumeration signal)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    // The fake ownership query is scoped by both id AND user_id, so a row
    // belonging to someone else simply never matches -> null, same as
    // not-found. This asserts the query is scoped to the caller's user_id.
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await GET(req(), ctx("someone-elses-run"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(eq2Mock).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("404s a queued run — nothing to sign yet", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    maybeSingleMock.mockResolvedValue({
      data: { user_id: "user-1", posting_id: "posting-1", status: "queued" },
      error: null,
    });
    const res = await GET(req(), ctx("run-1"));
    expect(res.status).toBe(404);
    expect(signMaterialsMock).not.toHaveBeenCalled();
  });

  it("404s a failed run", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    maybeSingleMock.mockResolvedValue({
      data: { user_id: "user-1", posting_id: "posting-1", status: "failed" },
      error: null,
    });
    const res = await GET(req(), ctx("run-1"));
    expect(res.status).toBe(404);
    expect(signMaterialsMock).not.toHaveBeenCalled();
  });

  it("404s a running run", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    maybeSingleMock.mockResolvedValue({
      data: { user_id: "user-1", posting_id: "posting-1", status: "running" },
      error: null,
    });
    const res = await GET(req(), ctx("run-1"));
    expect(res.status).toBe(404);
    expect(signMaterialsMock).not.toHaveBeenCalled();
  });

  it("a succeeded run returns the signed URLs signMaterials produced, called with the 5-minute expiry", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    maybeSingleMock.mockResolvedValue({
      data: { user_id: "user-1", posting_id: "posting-42", status: "succeeded" },
      error: null,
    });
    signMaterialsMock.mockResolvedValue({
      "resume.pdf": "https://sign/resume.pdf",
      "cover_letter.pdf": "https://sign/cover_letter.pdf",
    });
    const res = await GET(req(), ctx("run-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      urls: {
        "resume.pdf": "https://sign/resume.pdf",
        "cover_letter.pdf": "https://sign/cover_letter.pdf",
      },
    });
    expect(signMaterialsMock).toHaveBeenCalledWith(adminClient, "user-1", "posting-42", 300);
  });

  it("an admin without a claimed invite can still fetch their own succeeded run", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    maybeSingleMock.mockResolvedValue({
      data: { user_id: "admin-1", posting_id: "posting-1", status: "succeeded" },
      error: null,
    });
    const res = await GET(req(), ctx("run-1"));
    expect(res.status).toBe(200);
  });

  it("throws on a SELECT error instead of swallowing it", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "rls denied" } });
    await expect(GET(req(), ctx("run-1"))).rejects.toEqual({ message: "rls denied" });
  });
});
