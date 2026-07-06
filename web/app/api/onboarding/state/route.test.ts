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
vi.mock("@/lib/db/onboardingSession", () => ({ getOrCreateSession: getOrCreateSessionMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const runCalibrationGenerationMock = vi.fn();
vi.mock("@/lib/anthropic/interview", () => ({ runCalibrationGeneration: runCalibrationGenerationMock }));

const maybeGenerateCalibrationPromptsMock = vi.fn();
vi.mock("@/lib/onboarding/maybeGenerateCalibration", () => ({
  maybeGenerateCalibrationPrompts: maybeGenerateCalibrationPromptsMock,
}));

const { GET } = await import("./route");

describe("GET /api/onboarding/state", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasClaimedInviteMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue({ stage: "resume", messages: [], extracted: {}, status: "in_progress" });
    maybeGenerateCalibrationPromptsMock.mockReset();
    maybeGenerateCalibrationPromptsMock.mockResolvedValue({ stage: "resume", messages: [], status: "in_progress" });
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getOrCreateSessionMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getOrCreateSessionMock).not.toHaveBeenCalled();
  });

  it("succeeds with a claimed invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("ONB-A: delegates lazy calibration-prompt generation to maybeGenerateCalibrationPrompts and returns its result", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      stage: "calibration",
      messages: [],
      extracted: { anchor: { current_title: "Engineer", current_company: "Acme" } },
      status: "in_progress",
    });
    maybeGenerateCalibrationPromptsMock.mockResolvedValue({
      stage: "calibration",
      messages: [{ role: "assistant", content: "Four short prompts..." }],
      status: "in_progress",
    });

    const res = await GET();
    const body = await res.json();

    expect(maybeGenerateCalibrationPromptsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", runGeneration: runCalibrationGenerationMock })
    );
    expect(body.stage).toBe("calibration");
    expect(body.messages).toEqual([{ role: "assistant", content: "Four short prompts..." }]);
  });
});
