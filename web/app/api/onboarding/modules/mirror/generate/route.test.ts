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
const saveSessionMock = vi.fn(async () => {});
vi.mock("@/lib/db/onboardingSession", () => ({
  getOrCreateSession: getOrCreateSessionMock,
  saveSession: saveSessionMock,
}));

const recordOnboardingTurnMock = vi.fn(async () => {});
vi.mock("@/lib/db/ledger", () => ({ recordOnboardingTurn: recordOnboardingTurnMock }));

vi.mock("@/lib/anthropic/client", () => ({ ONBOARDING_MODEL: "claude-sonnet-5" }));

const runMirrorGenerationTurnMock = vi.fn();
vi.mock("@/lib/anthropic/moduleTurns", () => ({ runMirrorGenerationTurn: runMirrorGenerationTurnMock }));

const { POST } = await import("./route");

const USER_CORPUS = "I like to just ship things quickly and see what breaks.";

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "user-1",
    stage: "targeting",
    messages: [
      { role: "user", content: USER_CORPUS },
      { role: "assistant", content: "got it, tell me more" },
    ],
    extracted: {},
    modules: {},
    status: "in_progress",
    ...overrides,
  };
}

describe("POST /api/onboarding/modules/mirror/generate", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue(baseSession());
    saveSessionMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
    recordOnboardingTurnMock.mockClear();
    runMirrorGenerationTurnMock.mockReset();
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST();
    expect(res.status).toBe(401);
    expect(runMirrorGenerationTurnMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(runMirrorGenerationTurnMock).not.toHaveBeenCalled();
  });

  it("happy path: enough verbatim quotes survive the first call — no retry, one ledger row, count saved as 1", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    runMirrorGenerationTurnMock.mockResolvedValue({
      paragraphs: ["You ship things quickly.", "You notice what breaks."],
      quoted_phrases: ["ship things quickly", "see what breaks"],
      usage: { inputTokens: 300, outputTokens: 90 },
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      paragraphs: ["You ship things quickly.", "You notice what breaks."],
      quoted_phrases: ["ship things quickly", "see what breaks"],
    });

    expect(runMirrorGenerationTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      model: "claude-sonnet-5",
      inputTokens: 300,
      outputTokens: 90,
    });

    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          mirror_draft: { paragraphs: ["You ship things quickly.", "You notice what breaks."], quoted_phrases: ["ship things quickly", "see what breaks"] },
          mirror_generation_count: 1,
        }),
      })
    );
  });

  it("fewer than 2 verbatim quotes survive the first call and budget remains — auto-retries once, two ledger rows, drops the fabricated phrase from the final result", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    runMirrorGenerationTurnMock
      .mockResolvedValueOnce({
        paragraphs: ["Draft one.", "Draft one, part two."],
        // "ship things quickly" is a real substring of the user corpus;
        // the second phrase is fabricated (never appears anywhere in the
        // corpus) and must be dropped, leaving only 1 surviving quote —
        // below the 2-quote floor, so this should trigger the retry.
        quoted_phrases: ["ship things quickly", "we optimize synergy across verticals"],
        usage: { inputTokens: 300, outputTokens: 90 },
      })
      .mockResolvedValueOnce({
        paragraphs: ["Draft two.", "Draft two, part two."],
        quoted_phrases: ["ship things quickly", "see what breaks"],
        usage: { inputTokens: 320, outputTokens: 95 },
      });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Final result is the SECOND call's draft — the fabricated phrase from
    // the first call never appears anywhere in the response.
    expect(body).toEqual({
      paragraphs: ["Draft two.", "Draft two, part two."],
      quoted_phrases: ["ship things quickly", "see what breaks"],
    });
    expect(JSON.stringify(body)).not.toContain("synergy");

    expect(runMirrorGenerationTurnMock).toHaveBeenCalledTimes(2);
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(2);

    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({ mirror_generation_count: 2 }),
      })
    );
  });

  it('a "Try again" click after one manual success does not auto-retry even if quotes come up short — budget spent by exactly one more call', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue(
      baseSession({
        extracted: {
          mirror_generation_count: 1,
          mirror_draft: { paragraphs: ["Old.", "Old two."], quoted_phrases: ["ship things quickly", "see what breaks"] },
        },
      })
    );
    runMirrorGenerationTurnMock.mockResolvedValue({
      paragraphs: ["New.", "New two."],
      quoted_phrases: ["we optimize synergy across verticals"], // fabricated, drops to 0 surviving
      usage: { inputTokens: 300, outputTokens: 90 },
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ paragraphs: ["New.", "New two."], quoted_phrases: [] });

    // Exactly one call this request (count went 1 -> 2, so the "count < 2
    // after step 1" retry condition is false even though quotes came up
    // short) — never a third call for a session already at the budget.
    expect(runMirrorGenerationTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ extracted: expect.objectContaining({ mirror_generation_count: 2 }) })
    );
  });

  it('a "Try again" click after the budget is already spent skips the model entirely and returns the stale draft', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const staleDraft = { paragraphs: ["Stale.", "Stale two."], quoted_phrases: ["ship things quickly"] };
    getOrCreateSessionMock.mockResolvedValue(
      baseSession({ extracted: { mirror_generation_count: 2, mirror_draft: staleDraft } })
    );

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(staleDraft);

    expect(runMirrorGenerationTurnMock).not.toHaveBeenCalled();
    expect(recordOnboardingTurnMock).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("2026-07-21 fix: a card-only session (no chat messages) still verifies quotes drawn from card free-text and choices", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue(
      baseSession({
        messages: [],
        extracted: {
          trajectory: { direction: "switch", free_text: "ready to leave big-co politics behind" },
          energy: { hours_disappear: "debugging flaky CI at 2am", kept_putting_off: "" },
        },
      })
    );
    runMirrorGenerationTurnMock.mockResolvedValue({
      paragraphs: ["You're ready to leave big-co politics behind.", "Debugging flaky CI at 2am doesn't faze you."],
      quoted_phrases: ["ready to leave big-co politics behind", "debugging flaky CI at 2am"],
      usage: { inputTokens: 200, outputTokens: 80 },
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Before this fix, the corpus was chat-messages-only (empty here), so
    // both of these real quotes would have failed the verbatim check and
    // been dropped — exactly U2's reported bug.
    expect(body.quoted_phrases).toEqual(["ready to leave big-co politics behind", "debugging flaky CI at 2am"]);
  });
});
