import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

// Task 0 (phase1CheckpointIntegration.test.ts) fixed this route to call
// maybeFireCheckpoint after saveSession, same pattern as every other
// module-completion route — see reactions/route.test.ts and
// [key]/route.test.ts for why both of these need mocking: checkpointDeps.ts
// isn't mocked here (buildCheckpointDeps runs for real), so its own
// createSupabaseAdminClient() import needs a dummy client; checkpoint.ts's
// maybeFireCheckpoint is mocked away wholesale so this file doesn't also
// have to fake the admin-client chain checkpoint.ts's real logic calls.
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ __admin: true })),
}));

const maybeFireCheckpointMock = vi.fn(async (_deps: unknown, _session: unknown, _user: unknown) => {});
vi.mock("@/lib/onboarding/checkpoint", () => ({
  maybeFireCheckpoint: maybeFireCheckpointMock,
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getOrCreateSessionMock = vi.fn();
const saveSessionMock = vi.fn(async () => {});
vi.mock("@/lib/db/onboardingSession", () => ({
  getOrCreateSession: getOrCreateSessionMock,
  saveSession: saveSessionMock,
}));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/anchor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding/anchor", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue({
      stage: "anchor",
      messages: [],
      extracted: {},
      modules: {},
      status: "in_progress",
    });
    saveSessionMock.mockReset();
    maybeFireCheckpointMock.mockClear();
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ current_title: "Engineer", current_company: "Acme" }));
    expect(res.status).toBe(401);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await POST(jsonRequest({ current_title: "Engineer", current_company: "Acme" }));
    expect(res.status).toBe(403);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ current_title: "Engineer", current_company: "Acme" }));
    expect(res.status).toBe(200);
  });

  it("400s when neither current_title+current_company nor free_text is provided", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ current_title: "Engineer" }));
    expect(res.status).toBe(400);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("writes extracted.anchor and advances stage to calibration for the title/company path", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(
      jsonRequest({ current_title: "Senior Backend Engineer", current_company: "Acme Corp", years_in_role: "4 years" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe("calibration");
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        stage: "calibration",
        extracted: expect.objectContaining({
          anchor: { current_title: "Senior Backend Engineer", current_company: "Acme Corp", years_in_role: "4 years" },
        }),
        modules: expect.objectContaining({
          anchor: expect.objectContaining({ receipt: "Senior Backend Engineer · Acme Corp" }),
        }),
      })
    );
  });

  it("marks modules.anchor complete so phaseOneComplete can eventually fire (V3A-B1 fix)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      stage: "anchor",
      messages: [],
      extracted: {},
      modules: { values: { completed_at: "t", receipt: "r" } },
      status: "in_progress",
    });
    await POST(jsonRequest({ free_text: "Between roles" }));
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        modules: expect.objectContaining({
          values: { completed_at: "t", receipt: "r" }, // untouched
          anchor: expect.objectContaining({ receipt: "Between roles" }),
        }),
      })
    );
  });

  it("writes extracted.anchor.free_text for the no-title escape path", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ free_text: "Final-year CS student, internships in backend dev" }));
    expect(res.status).toBe(200);
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          anchor: { free_text: "Final-year CS student, internships in backend dev" },
        }),
      })
    );
  });

  it("preserves any pre-existing extracted fields (merge, not overwrite)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      stage: "anchor",
      messages: [],
      extracted: { targeting: { tiers: [{ key: "tier_1", label: "x" }], hard_disqualifiers: [], soft_concerns: [], thesis_summary: "t" } },
      modules: {},
      status: "in_progress",
    });
    await POST(jsonRequest({ current_title: "Engineer", current_company: "Acme" }));
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          targeting: expect.objectContaining({ thesis_summary: "t" }),
        }),
      })
    );
  });

  it("409s and writes nothing when the session has already moved past the anchor stage (replay/resubmit guard)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      stage: "targeting",
      messages: [{ role: "assistant", content: "..." }],
      extracted: { targeting: { tiers: [], hard_disqualifiers: [], soft_concerns: [], thesis_summary: "t" } },
      status: "in_progress",
    });
    const res = await POST(jsonRequest({ current_title: "Engineer", current_company: "Acme" }));
    expect(res.status).toBe(409);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("409s when the session is already complete, even though status alone wouldn't otherwise block it", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({ stage: "done", messages: [], extracted: {}, status: "complete" });
    const res = await POST(jsonRequest({ current_title: "Engineer", current_company: "Acme" }));
    expect(res.status).toBe(409);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("calls maybeFireCheckpoint after saveSession (Task 0 fix — anchor can be the last phase-1 module to complete)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    await POST(jsonRequest({ current_title: "Engineer", current_company: "Acme" }));
    expect(maybeFireCheckpointMock).toHaveBeenCalledTimes(1);
    const [, session, user] = maybeFireCheckpointMock.mock.calls[0];
    expect((session as { extracted: Record<string, unknown> }).extracted.anchor).toEqual({
      current_title: "Engineer",
      current_company: "Acme",
    });
    expect(user).toEqual({ id: "user-1" });
  });

  it("never calls the Anthropic client or records a ledger row (zero-LLM stage)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    await POST(jsonRequest({ current_title: "Engineer", current_company: "Acme" }));
    // No ledger/anthropic mocks are wired into this test file at all — if
    // the route tried to call either, the unmocked module would throw
    // (missing ANTHROPIC_API_KEY / unmocked db call), which the test
    // would surface as a rejected promise from POST().
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
  });
});
