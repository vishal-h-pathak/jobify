import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const getOrCreateSessionMock = vi.fn();
vi.mock("@/lib/db/onboardingSession", () => ({ getOrCreateSession: getOrCreateSessionMock }));

const runInterviewTurnMock = vi.fn();
vi.mock("@/lib/anthropic/interview", () => ({ runInterviewTurn: runInterviewTurnMock }));

const handleOnboardingTurnMock = vi.fn();
vi.mock("@/lib/onboarding/handleTurn", () => ({ handleOnboardingTurn: handleOnboardingTurnMock }));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding/turn", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasClaimedInviteMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue({ stage: "resume", messages: [], extracted: {}, status: "in_progress" });
    handleOnboardingTurnMock.mockReset();
    handleOnboardingTurnMock.mockResolvedValue({ assistantText: "hi", stage: "resume", done: false });
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ message: "hello" }));
    expect(res.status).toBe(401);
    expect(handleOnboardingTurnMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await POST(jsonRequest({ message: "hello" }));
    expect(res.status).toBe(403);
    expect(handleOnboardingTurnMock).not.toHaveBeenCalled();
  });

  it("succeeds with a claimed invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "user-1@example.com" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ message: "hello" }));
    expect(res.status).toBe(200);
    expect(handleOnboardingTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: "user-1@example.com" })
    );
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    const res = await POST(jsonRequest({ message: "hello" }));
    expect(res.status).toBe(200);
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });
});
