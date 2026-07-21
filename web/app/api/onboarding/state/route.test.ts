import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const matchCountResultMock = vi.fn(async () => ({ count: 0, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => matchCountResultMock()),
        })),
      })),
    })),
  })),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

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
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue({
      stage: "resume",
      messages: [],
      extracted: {},
      modules: {},
      status: "in_progress",
    });
    maybeGenerateCalibrationPromptsMock.mockReset();
    maybeGenerateCalibrationPromptsMock.mockResolvedValue({ stage: "resume", messages: [], status: "in_progress" });
    matchCountResultMock.mockReset();
    matchCountResultMock.mockResolvedValue({ count: 0, error: null });
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getOrCreateSessionMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getOrCreateSessionMock).not.toHaveBeenCalled();
  });

  it("succeeds with a claimed invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("ONB-A: delegates lazy calibration-prompt generation to maybeGenerateCalibrationPrompts and returns its result", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      stage: "calibration",
      messages: [],
      extracted: { anchor: { current_title: "Engineer", current_company: "Acme" } },
      modules: {},
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

  it("V3A-B1: extends the response with modules, next_module, checkpoint_fired, match_count, and the value/environment scenario data", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      stage: "anchor",
      messages: [],
      extracted: {},
      modules: {},
      status: "in_progress",
    });
    maybeGenerateCalibrationPromptsMock.mockResolvedValue({ stage: "anchor", messages: [], status: "in_progress" });
    matchCountResultMock.mockResolvedValue({ count: 3, error: null });

    const res = await GET();
    const body = await res.json();

    expect(body.modules).toEqual({});
    expect(body.next_module).toBe("anchor");
    expect(body.checkpoint_fired).toBe(false);
    expect(body.match_count).toBe(3);
    expect(Array.isArray(body.value_pairs)).toBe(true);
    expect(body.value_pairs.length).toBeGreaterThan(0);
    expect(Array.isArray(body.environment_scenarios)).toBe(true);
    expect(body.environment_scenarios.length).toBeGreaterThan(0);
  });

  it("V3A-B1: next_module skips complete modules and checkpoint_fired reflects modules.checkpoint_hunt", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const modules = {
      anchor: { completed_at: "t", receipt: "Engineer · Acme" },
      reactions: { completed_at: "t", receipt: "6 reactions (4 interested)" },
      values: { completed_at: "t", receipt: "7 trade-offs answered" },
      dealbreakers: { completed_at: "t", receipt: "2 dealbreakers" },
      checkpoint_hunt: { fired_at: "2026-07-16T00:00:00.000Z" },
    };
    getOrCreateSessionMock.mockResolvedValue({
      stage: "calibration",
      messages: [],
      extracted: {},
      modules,
      status: "in_progress",
    });
    maybeGenerateCalibrationPromptsMock.mockResolvedValue({ stage: "calibration", messages: [], status: "in_progress" });

    const res = await GET();
    const body = await res.json();

    expect(body.next_module).toBe("energy");
    expect(body.checkpoint_fired).toBe(true);
    expect(body.modules).toEqual(modules);
  });
});
