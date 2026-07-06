import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatMessage } from "../anthropic/interview";

const saveSessionMock = vi.fn(async (..._args: unknown[]) => {});
const recordOnboardingTurnMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("../db/onboardingSession", () => ({ saveSession: saveSessionMock }));
vi.mock("../db/ledger", () => ({ recordOnboardingTurn: recordOnboardingTurnMock }));

const { maybeGenerateCalibrationPrompts } = await import("./maybeGenerateCalibration");

const fakeClient = {} as never;

function baseSession(overrides: Partial<Parameters<typeof maybeGenerateCalibrationPrompts>[0]["session"]> = {}) {
  return {
    stage: "calibration" as const,
    messages: [] as ChatMessage[],
    extracted: { anchor: { current_title: "Backend Engineer", current_company: "Acme" } },
    status: "in_progress" as const,
    ...overrides,
  };
}

describe("maybeGenerateCalibrationPrompts", () => {
  beforeEach(() => {
    saveSessionMock.mockClear();
    recordOnboardingTurnMock.mockClear();
  });

  it("is a no-op when the stage isn't calibration", async () => {
    const runGeneration = vi.fn();
    const session = baseSession({ stage: "resume" });
    const result = await maybeGenerateCalibrationPrompts({
      userId: "user-1",
      session,
      supabase: fakeClient,
      admin: fakeClient,
      runGeneration,
    });
    expect(runGeneration).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(result).toEqual({ stage: "resume", messages: [], status: "in_progress" });
  });

  it("is a no-op when calibration prompts are already generated", async () => {
    const runGeneration = vi.fn();
    const session = baseSession({ extracted: { calibration: { prompts: ["a", "b", "c", "d"] } } });
    await maybeGenerateCalibrationPrompts({
      userId: "user-1",
      session,
      supabase: fakeClient,
      admin: fakeClient,
      runGeneration,
    });
    expect(runGeneration).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("defensively no-ops when stage is calibration but no anchor exists yet", async () => {
    const runGeneration = vi.fn();
    const session = baseSession({ extracted: {} });
    await maybeGenerateCalibrationPrompts({
      userId: "user-1",
      session,
      supabase: fakeClient,
      admin: fakeClient,
      runGeneration,
    });
    expect(runGeneration).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("generates once, records exactly one ledger row, and persists the prompts + intro message", async () => {
    const runGeneration = vi.fn(async () => ({
      prompts: ["Depth?", "Breadth?", "Range?", "Evidence?"],
      usage: { inputTokens: 100, outputTokens: 50 },
    }));
    const session = baseSession();

    const result = await maybeGenerateCalibrationPrompts({
      userId: "user-1",
      session,
      supabase: fakeClient,
      admin: fakeClient,
      runGeneration,
    });

    expect(runGeneration).toHaveBeenCalledTimes(1);
    expect(runGeneration).toHaveBeenCalledWith(session.extracted.anchor);
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ userId: "user-1", inputTokens: 100, outputTokens: 50 })
    );

    expect(result.stage).toBe("calibration");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[0].content).toContain("Not a test — no scores, no wrong answers.");
    expect(result.messages[0].content).toContain("Depth?");
    expect(result.messages[0].content).toContain("Evidence?");

    expect(saveSessionMock).toHaveBeenCalledWith(
      fakeClient,
      "user-1",
      expect.objectContaining({
        stage: "calibration",
        status: "in_progress",
        extracted: expect.objectContaining({ calibration: { prompts: ["Depth?", "Breadth?", "Range?", "Evidence?"] } }),
      })
    );
  });

  it("preserves other extracted fields when merging in the generated prompts", async () => {
    const runGeneration = vi.fn(async () => ({
      prompts: ["a", "b", "c", "d"],
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    const session = baseSession({
      extracted: {
        anchor: { current_title: "Engineer", current_company: "Acme" },
        identity: { name: "Alex", email: "alex@example.com" },
      },
    });

    await maybeGenerateCalibrationPrompts({
      userId: "user-1",
      session,
      supabase: fakeClient,
      admin: fakeClient,
      runGeneration,
    });

    const savedExtracted = (saveSessionMock.mock.calls[0][2] as { extracted: Record<string, unknown> }).extracted;
    expect(savedExtracted.identity).toEqual({ name: "Alex", email: "alex@example.com" });
    expect(savedExtracted.anchor).toEqual({ current_title: "Engineer", current_company: "Acme" });
  });
});
