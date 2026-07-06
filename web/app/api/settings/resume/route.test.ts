import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getProfileDocMock = vi.fn();
const upsertProfileDocMock = vi.fn(async () => ({ status: "valid", errors: [] }));
vi.mock("@/lib/db/profiles", () => ({
  getProfileDoc: getProfileDocMock,
  upsertProfileDoc: upsertProfileDocMock,
}));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const recordOnboardingTurnMock = vi.fn(async () => {});
vi.mock("@/lib/db/ledger", () => ({ recordOnboardingTurn: recordOnboardingTurnMock }));

const runResumeExtractionTurnMock = vi.fn();
vi.mock("@/lib/anthropic/interview", () => ({ runResumeExtractionTurn: runResumeExtractionTurnMock }));

vi.mock("@/lib/anthropic/client", () => ({ ONBOARDING_MODEL: "claude-sonnet-5" }));

const regenerateCvMock = vi.fn();
vi.mock("@/lib/profile/regenerateCv", () => ({ regenerateCv: regenerateCvMock }));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/settings/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/settings/resume", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasClaimedInviteMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getProfileDocMock.mockReset();
    getProfileDocMock.mockResolvedValue({ doc: { "cv.md": "old resume" }, validationStatus: { status: "valid", errors: [] } });
    upsertProfileDocMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
    recordOnboardingTurnMock.mockClear();
    runResumeExtractionTurnMock.mockReset();
    runResumeExtractionTurnMock.mockResolvedValue({
      cv_markdown: "## New Resume\n- did things",
      background_summary: "Does things.",
      usage: { inputTokens: 1000, outputTokens: 200 },
    });
    regenerateCvMock.mockReset();
    regenerateCvMock.mockResolvedValue({ "cv.md": "## New Resume\n- did things", "profile.yml": "identity: {}\n" });
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ resumeText: "some resume text" }));
    expect(res.status).toBe(401);
    expect(runResumeExtractionTurnMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await POST(jsonRequest({ resumeText: "some resume text" }));
    expect(res.status).toBe(403);
    expect(runResumeExtractionTurnMock).not.toHaveBeenCalled();
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    isAdminMock.mockReturnValue(true);
    const res = await POST(jsonRequest({ resumeText: "some resume text" }));
    expect(res.status).toBe(200);
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("400s when resumeText is missing or blank", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ resumeText: "   " }));
    expect(res.status).toBe(400);
    expect(runResumeExtractionTurnMock).not.toHaveBeenCalled();
  });

  it("404s when the user has no profile yet — never calls the extraction turn", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue(null);
    const res = await POST(jsonRequest({ resumeText: "some resume text" }));
    expect(res.status).toBe(404);
    expect(runResumeExtractionTurnMock).not.toHaveBeenCalled();
  });

  it("a failed extraction propagates and never touches the stored doc (old cv.md survives)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    runResumeExtractionTurnMock.mockRejectedValue(new Error("anthropic boom"));
    await expect(POST(jsonRequest({ resumeText: "some resume text" }))).rejects.toThrow("anthropic boom");
    expect(regenerateCvMock).not.toHaveBeenCalled();
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
    expect(recordOnboardingTurnMock).not.toHaveBeenCalled();
  });

  it("happy path: extracts, ledgers the turn, regenerates via regenerateCv, upserts, and returns provenance", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ resumeText: "  some resume text  " }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, provenance: "resume" });

    expect(runResumeExtractionTurnMock).toHaveBeenCalledWith("some resume text");
    expect(recordOnboardingTurnMock).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 200,
    });

    expect(regenerateCvMock).toHaveBeenCalledTimes(1);
    const [doc, resumeText, deps] = regenerateCvMock.mock.calls[0];
    expect(doc).toEqual({ "cv.md": "old resume" });
    expect(resumeText).toBe("some resume text");
    await expect(deps.runExtraction("irrelevant")).resolves.toEqual({
      cv_markdown: "## New Resume\n- did things",
      background_summary: "Does things.",
      usage: { inputTokens: 1000, outputTokens: 200 },
    });

    expect(upsertProfileDocMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      { "cv.md": "## New Resume\n- did things", "profile.yml": "identity: {}\n" }
    );
  });

  it("derives 'interview' provenance when the regenerated cv.md carries the synthesized marker", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    regenerateCvMock.mockResolvedValue({ "cv.md": "# CV — assembled from onboarding interview (no resume provided)\n" });
    const res = await POST(jsonRequest({ resumeText: "some resume text" }));
    const body = await res.json();
    expect(body.provenance).toBe("interview");
  });
});
