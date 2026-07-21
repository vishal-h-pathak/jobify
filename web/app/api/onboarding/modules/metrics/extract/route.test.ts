import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const createSupabaseAdminClientMock = vi.fn(() => ({ __admin: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getOrCreateSessionMock = vi.fn();
const saveSessionMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/db/onboardingSession", () => ({
  getOrCreateSession: getOrCreateSessionMock,
  saveSession: saveSessionMock,
}));

const getProfileDocMock = vi.fn();
vi.mock("@/lib/db/profiles", () => ({
  getProfileDoc: getProfileDocMock,
}));

const recordOnboardingTurnMock = vi.fn(async () => {});
vi.mock("@/lib/db/ledger", () => ({ recordOnboardingTurn: recordOnboardingTurnMock }));

vi.mock("@/lib/anthropic/client", () => ({ ONBOARDING_MODEL: "claude-sonnet-5" }));

const runMetricsExtractionTurnMock = vi.fn();
vi.mock("@/lib/anthropic/moduleTurns", () => ({ runMetricsExtractionTurn: runMetricsExtractionTurnMock }));

const { POST } = await import("./route");

const BASE_SESSION = {
  user_id: "user-1",
  stage: "targeting",
  messages: [
    { role: "user", content: "cut deploy time from 40 minutes to 6" },
    { role: "assistant", content: "nice, tell me more" },
  ],
  extracted: {
    calibration: { evidence: ["shipped the migration end to end"], range_statement: "senior IC range" },
    energy: { hours_disappear: "debugging prod issues", kept_putting_off: "writing docs" },
    anchor: { current_title: "Engineer", current_company: "Acme", free_text: "" },
  },
  modules: {},
  status: "in_progress",
};

describe("POST /api/onboarding/modules/metrics/extract", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue(BASE_SESSION);
    saveSessionMock.mockClear();
    getProfileDocMock.mockReset();
    getProfileDocMock.mockResolvedValue({ doc: { "cv.md": "Reduced latency by 30% in Q1." }, validationStatus: null });
    createSupabaseAdminClientMock.mockClear();
    recordOnboardingTurnMock.mockClear();
    runMetricsExtractionTurnMock.mockReset();
    runMetricsExtractionTurnMock.mockResolvedValue({
      claims: [{ id: "claim_1", text: "cut deploy time from 40 minutes to 6", source: "energy", has_number: true }],
      usage: { inputTokens: 500, outputTokens: 120 },
    });
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST();
    expect(res.status).toBe(401);
    expect(runMetricsExtractionTurnMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(runMetricsExtractionTurnMock).not.toHaveBeenCalled();
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    const res = await POST();
    expect(res.status).toBe(200);
  });

  it("happy path: sweeps cv.md + calibration + energy + anchor + user messages, ledgers once, stores pending claims (no module completion)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      claims: [{ id: "claim_1", text: "cut deploy time from 40 minutes to 6", source: "energy", has_number: true }],
    });

    const [searchableText] = runMetricsExtractionTurnMock.mock.calls[0];
    expect(searchableText).toContain("Reduced latency by 30% in Q1.");
    expect(searchableText).toContain("shipped the migration end to end");
    expect(searchableText).toContain("senior IC range");
    expect(searchableText).toContain("debugging prod issues");
    expect(searchableText).toContain("writing docs");
    expect(searchableText).toContain("Engineer");
    expect(searchableText).toContain("Acme");
    expect(searchableText).toContain("cut deploy time from 40 minutes to 6");
    // assistant turns never leak into the sweep — only role === "user"
    expect(searchableText).not.toContain("nice, tell me more");

    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      model: "claude-sonnet-5",
      inputTokens: 500,
      outputTokens: 120,
    });

    // Pre-marking step: extracted.metrics.claims only, and no `modules` key
    // in the update at all — this route never marks the module complete.
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
    expect(saveSessionMock).toHaveBeenCalledWith(expect.anything(), "user-1", {
      extracted: expect.objectContaining({
        metrics: { claims: [{ id: "claim_1", text: "cut deploy time from 40 minutes to 6", source: "energy", has_number: true }] },
      }),
    });
    const [, , update] = saveSessionMock.mock.calls[0];
    expect(update).not.toHaveProperty("modules");
  });

  it("drops a fabricated claim that never appears anywhere in the swept text", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    runMetricsExtractionTurnMock.mockResolvedValue({
      claims: [
        { id: "claim_1", text: "cut deploy time from 40 minutes to 6", source: "energy", has_number: true },
        // Never appears in cv.md, calibration, energy, anchor, or any user
        // message — a hallucinated claim the verbatim filter must drop.
        { id: "claim_2", text: "grew revenue 400% in a single quarter", source: "cv", has_number: true },
      ],
      usage: { inputTokens: 500, outputTokens: 120 },
    });
    const res = await POST();
    const body = await res.json();
    expect(body.claims).toEqual([
      { id: "claim_1", text: "cut deploy time from 40 minutes to 6", source: "energy", has_number: true },
    ]);
  });
});
