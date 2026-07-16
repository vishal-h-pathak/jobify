import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getOrCreateSessionMock = vi.fn();
const saveSessionMock = vi.fn(async () => {});
vi.mock("@/lib/db/onboardingSession", () => ({
  getOrCreateSession: getOrCreateSessionMock,
  saveSession: saveSessionMock,
}));

const getProfileDocMock = vi.fn();
const upsertProfileDocMock = vi.fn(async (..._args: unknown[]) => ({ status: "valid", errors: [] }));
vi.mock("@/lib/db/profiles", () => ({
  getProfileDoc: getProfileDocMock,
  upsertProfileDoc: upsertProfileDocMock,
}));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/modules/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CLAIMS = [
  { id: "claim_1", text: "cut deploy time from 40 minutes to 6", source: "energy", has_number: true },
  { id: "claim_2", text: "led a team of 4 engineers", source: "cv", has_number: true },
];

const BASE_SESSION = {
  user_id: "user-1",
  stage: "targeting",
  messages: [],
  extracted: { metrics: { claims: CLAIMS } },
  modules: {},
  status: "in_progress",
};

describe("POST /api/onboarding/modules/metrics", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasClaimedInviteMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue(BASE_SESSION);
    saveSessionMock.mockClear();
    getProfileDocMock.mockReset();
    getProfileDocMock.mockResolvedValue(null);
    upsertProfileDocMock.mockClear();
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ marks: [] }));
    expect(res.status).toBe(401);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await POST(jsonRequest({ marks: [] }));
    expect(res.status).toBe(403);
  });

  it("400s when marks isn't a well-formed array", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ marks: [{ id: "claim_1" }] }));
    expect(res.status).toBe(400);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("400s when the extract step never ran (no extracted.metrics.claims)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({ ...BASE_SESSION, extracted: {} });
    const res = await POST(
      jsonRequest({ marks: [{ id: "claim_1", confident: true }, { id: "claim_2", confident: false }] })
    );
    expect(res.status).toBe(400);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("400s when marks is missing a claim id", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ marks: [{ id: "claim_1", confident: true }] }));
    expect(res.status).toBe(400);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("400s when marks includes an unknown claim id", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(
      jsonRequest({
        marks: [
          { id: "claim_1", confident: true },
          { id: "claim_2", confident: true },
          { id: "claim_unknown", confident: false },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("400s when marks duplicates a claim id", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(
      jsonRequest({
        marks: [
          { id: "claim_1", confident: true },
          { id: "claim_1", confident: false },
          { id: "claim_2", confident: true },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("happy path: splits confirmed/never_use, marks metrics complete, and saves the session", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(
      jsonRequest({ marks: [{ id: "claim_1", confident: true }, { id: "claim_2", confident: false }] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.key).toBe("metrics");
    expect(typeof body.receipt).toBe("string");

    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          metrics: {
            claims: CLAIMS,
            confirmed: [CLAIMS[0]],
            never_use: [CLAIMS[1]],
          },
        }),
        modules: expect.objectContaining({ metrics: expect.objectContaining({ receipt: expect.any(String) }) }),
      })
    );
  });

  it("skips applyMetricsToDoc/upsertProfileDoc when no profiles row exists yet", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue(null);
    await POST(jsonRequest({ marks: [{ id: "claim_1", confident: true }, { id: "claim_2", confident: false }] }));
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
  });

  it("applies to the doc and upserts when a profiles row already exists", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue({ doc: { "article-digest.md": "" }, validationStatus: null });
    await POST(jsonRequest({ marks: [{ id: "claim_1", confident: true }, { id: "claim_2", confident: false }] }));
    expect(upsertProfileDocMock).toHaveBeenCalledTimes(1);
    const [, , doc] = upsertProfileDocMock.mock.calls[0];
    expect((doc as Record<string, string>)["article-digest.md"]).toContain("cut deploy time from 40 minutes to 6");
    expect((doc as Record<string, string>)["article-digest.md"]).toContain("led a team of 4 engineers");
  });
});
