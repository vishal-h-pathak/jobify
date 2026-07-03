import { describe, expect, it, vi, beforeEach } from "vitest";

const saveSessionMock = vi.fn(async (..._args: unknown[]) => {});
const upsertProfileDocMock = vi.fn(async (_supabase: unknown, _userId: string, _doc: Record<string, string>) => ({
  status: "valid" as const,
  errors: [] as string[],
}));
const recordOnboardingTurnMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("../db/onboardingSession", () => ({ saveSession: saveSessionMock }));
vi.mock("../db/profiles", () => ({ upsertProfileDoc: upsertProfileDocMock }));
vi.mock("../db/ledger", () => ({ recordOnboardingTurn: recordOnboardingTurnMock }));

const { handleOnboardingTurn } = await import("./handleTurn");

const fakeClient = {} as never;

function baseSession(overrides: Partial<Parameters<typeof handleOnboardingTurn>[0]["session"]> = {}) {
  return {
    stage: "resume" as const,
    messages: [],
    extracted: {},
    status: "in_progress" as const,
    ...overrides,
  };
}

describe("handleOnboardingTurn", () => {
  beforeEach(() => {
    saveSessionMock.mockClear();
    upsertProfileDocMock.mockClear();
    recordOnboardingTurnMock.mockClear();
  });

  it("records exactly one budget_ledger row per turn", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "Thanks — tell me about your background.",
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userMessage: "here is my resume",
      session: baseSession(),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ userId: "user-1", inputTokens: 100, outputTokens: 50 })
    );
  });

  it("saves the session as in_progress and does not upsert a profile mid-interview", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "Got it — what's your target comp?",
      toolCalls: [{ name: "record_identity", input: { name: "A", email: "a@example.com" } }],
      usage: { inputTokens: 10, outputTokens: 10 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userMessage: "Alex, alex@example.com",
      session: baseSession({ stage: "identity" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(result.done).toBe(false);
    expect(result.stage).toBe("targeting");
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
    expect(saveSessionMock).toHaveBeenCalledWith(
      fakeClient,
      "user-1",
      expect.objectContaining({ status: "in_progress", stage: "targeting" })
    );
  });

  it("builds and upserts the profile doc when finish_interview fires, and marks the session complete", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "All set!",
      toolCalls: [{ name: "finish_interview", input: {} }],
      usage: { inputTokens: 20, outputTokens: 5 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userMessage: "yes that's everything",
      session: baseSession({
        stage: "targeting",
        extracted: {
          identity: { name: "Alex", email: "alex@example.com" },
          targeting: {
            tiers: [{ key: "tier_1", label: "Backend engineering" }],
            hard_disqualifiers: [],
            soft_concerns: [],
            thesis_summary: "Wants backend roles.",
          },
        },
      }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(result.done).toBe(true);
    expect(result.validation?.status).toBe("valid");
    expect(upsertProfileDocMock).toHaveBeenCalledTimes(1);
    const [, , doc] = upsertProfileDocMock.mock.calls[0];
    expect(doc["profile.yml"]).toContain("Alex");
    expect(saveSessionMock).toHaveBeenCalledWith(fakeClient, "user-1", expect.objectContaining({ status: "complete" }));
  });

  it("short-circuits (no Anthropic call, no ledger row) once the session is already complete", async () => {
    const runTurn = vi.fn();

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userMessage: "hi again",
      session: baseSession({ status: "complete", stage: "done" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(result.done).toBe(true);
    expect(runTurn).not.toHaveBeenCalled();
    expect(recordOnboardingTurnMock).not.toHaveBeenCalled();
  });
});
