import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const sessionSelectResult = { data: null as unknown, error: null as unknown };
const fromCalls: string[] = [];

function fakeSupabase() {
  return {
    auth: { getUser: getUserMock },
    from(table: string) {
      fromCalls.push(table);
      if (table !== "onboarding_sessions") throw new Error(`unexpected table ${table}`);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => Promise.resolve(sessionSelectResult);
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeSupabase()),
}));

const createSupabaseAdminClientMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const intakeCompleteMock = vi.fn();
vi.mock("@/lib/onboarding/intakeComplete", () => ({ intakeComplete: intakeCompleteMock }));

const getProfileDocMock = vi.fn();
vi.mock("@/lib/db/profiles", () => ({ getProfileDoc: getProfileDocMock }));

const { GET } = await import("./route");

const FULL_DOC: Record<string, string> = {
  "profile.yml": "identity:\n  name: Alex Quinn\n",
  "thesis.md": "# Hunting thesis\n\nYou build things that work under pressure.\n",
  "article-digest.md": "# article-digest\n\n## Confirmed metrics\n- Cut latency 40%\n\n## Never use\n",
  "cv.md": "# CV\n\n## Skills\n\n- RF design\n",
  "learned-insights.md": "",
};

describe("GET /api/profile/export", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasClaimedInviteMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    intakeCompleteMock.mockReset();
    intakeCompleteMock.mockResolvedValue(true);
    getProfileDocMock.mockReset();
    getProfileDocMock.mockResolvedValue({ doc: FULL_DOC, validationStatus: { status: "valid", errors: [] } });
    createSupabaseAdminClientMock.mockClear();
    fromCalls.length = 0;
    sessionSelectResult.data = { modules: { anchor: { completed_at: "2026-07-10T10:00:00.000Z", receipt: "r" } }, extracted: { identity: { name: "Alex Quinn" } } };
    sessionSelectResult.error = null;
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("an admin without a claimed invite still succeeds — bypasses the invite gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    isAdminMock.mockReturnValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("409s with intake_incomplete before intake finishes", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    intakeCompleteMock.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "intake_incomplete" });
    expect(getProfileDocMock).not.toHaveBeenCalled();
  });

  it("404s when intake is complete but there's somehow no profiles row", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("200s with markdown, the download content-type, and a dated filename", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="dossier-alex-\d{4}-\d{2}-\d{2}\.md"$/
    );
    const body = await res.text();
    expect(body).toContain("# Alex Quinn");
    expect(body).toContain("Every line traces to my own words.");
  });

  it("constitution: never touches application_profiles or the service-role admin client", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    await GET();
    expect(fromCalls).not.toContain("application_profiles");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });
});
