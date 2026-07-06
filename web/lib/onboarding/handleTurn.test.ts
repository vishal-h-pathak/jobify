import { describe, expect, it, vi, beforeEach } from "vitest";
import { SEEDED_GREETING } from "../anthropic/interview";
import type { ChatMessage } from "../anthropic/interview";

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
      userEmail: "user-1@example.com",
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
      userEmail: "user-1@example.com",
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

  it("overwrites a model-supplied (bogus) record_identity email with deps.userEmail, unconditionally", async () => {
    const runTurn = vi.fn(async (_history: ChatMessage[]) => ({
      assistantText: "Got it — what's your target comp?",
      toolCalls: [
        { name: "record_identity", input: { name: "Alex", email: "totally-made-up@nowhere.invalid" } },
      ],
      usage: { inputTokens: 10, outputTokens: 10 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "real-auth-email@example.com",
      userMessage: "Alex, totally-made-up@nowhere.invalid",
      session: baseSession({ stage: "identity" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    // The tool call the (mocked) model returned genuinely included a bogus
    // email — assert on the history/tool-call itself so this test can't
    // pass by accident (e.g. if applyToolCalls were changed to drop email).
    const historyArg = runTurn.mock.calls[0][0];
    expect(historyArg.at(-1)).toEqual({ role: "user", content: "Alex, totally-made-up@nowhere.invalid" });

    // The persisted extracted.identity.email must be the auth email, never
    // the model-supplied one, even though the model DID supply a value.
    const savedArg = saveSessionMock.mock.calls[0][2] as {
      extracted: { identity?: { email?: string } };
    };
    expect(savedArg.extracted.identity?.email).toBe("real-auth-email@example.com");
    expect(savedArg.extracted.identity?.email).not.toBe("totally-made-up@nowhere.invalid");
  });

  it("builds and upserts the profile doc when finish_interview fires, and marks the session complete", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "All set!",
      toolCalls: [{ name: "finish_interview", input: {} }],
      usage: { inputTokens: 20, outputTokens: 5 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
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

  it("prepends the seeded greeting on the very first turn (empty session.messages) without an extra LLM/ledger call", async () => {
    const runTurn = vi.fn(async (_history: ChatMessage[]) => ({
      assistantText: "Nice — tell me more about what kind of work you're after.",
      toolCalls: [],
      usage: { inputTokens: 30, outputTokens: 15 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "I do backend engineering, I'd love more systems design work",
      session: baseSession({ messages: [] }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    // The history passed to runTurn must start with the seeded greeting,
    // followed by the user's message — not an extra runTurn call.
    expect(runTurn).toHaveBeenCalledTimes(1);
    const historyArg = runTurn.mock.calls[0][0];
    expect(historyArg[0]).toEqual({ role: "assistant", content: SEEDED_GREETING });
    expect(historyArg[1]).toEqual({
      role: "user",
      content: "I do backend engineering, I'd love more systems design work",
    });

    // The persisted newMessages (passed to saveSession) must also start
    // with the greeting, so a page reload shows the full transcript.
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
    const savedMessages = (
      saveSessionMock.mock.calls[0][2] as { messages: ChatMessage[] }
    ).messages;
    expect(savedMessages[0]).toEqual({ role: "assistant", content: SEEDED_GREETING });
    expect(savedMessages[1]).toEqual({
      role: "user",
      content: "I do backend engineering, I'd love more systems design work",
    });

    // Still exactly one budget_ledger row for this turn — the prepend is
    // local bookkeeping, not an extra Anthropic call.
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT prepend the seeded greeting on subsequent turns (non-empty session.messages)", async () => {
    const runTurn = vi.fn(async (_history: ChatMessage[]) => ({
      assistantText: "Got it, continuing.",
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "here is more detail",
      session: baseSession({
        messages: [
          { role: "assistant", content: SEEDED_GREETING },
          { role: "user", content: "I do backend engineering" },
          { role: "assistant", content: "Nice — tell me more." },
        ],
      }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    const historyArg = runTurn.mock.calls[0][0];
    expect(historyArg).toHaveLength(4);
    expect(historyArg[0]).toEqual({ role: "assistant", content: SEEDED_GREETING });
    expect(historyArg.filter((m) => m.content === SEEDED_GREETING)).toHaveLength(1);
  });

  it("FIX-1: retries once on an empty assistant response, then falls back to a deterministic stage-appropriate question if still empty", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "",
      toolCalls: [],
      usage: { inputTokens: 5, outputTokens: 0 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "ok",
      session: baseSession({ stage: "identity" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    // Retried exactly once (two total attempts), never more.
    expect(runTurn).toHaveBeenCalledTimes(2);

    // The user must see a non-empty, stage-appropriate question — never a
    // blank bubble.
    expect(result.assistantText.trim()).not.toBe("");
    expect(result.assistantText).toContain("?");
    expect(result.assistantText).toMatch(/logistics|salary floor/i);

    // A blank turn must never be persisted to messages.
    const savedMessages = (saveSessionMock.mock.calls[0][2] as { messages: ChatMessage[] }).messages;
    expect(savedMessages.every((m) => m.content.trim() !== "")).toBe(true);
    expect(savedMessages.at(-1)?.content).toBe(result.assistantText);

    // Still exactly one budget_ledger row, even though runTurn fired twice.
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
  });

  it("FIX-1: does not retry when the first assistant response is non-empty", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "Got it — what's your target comp?",
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "40 hourly",
      session: baseSession({ stage: "identity" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(runTurn).toHaveBeenCalledTimes(1);
  });

  it("FIX-1: recovers if the retry attempt returns real text (uses the retry's text, not the fallback)", async () => {
    let call = 0;
    const runTurn = vi.fn(async () => {
      call += 1;
      if (call === 1) return { assistantText: "", toolCalls: [], usage: { inputTokens: 5, outputTokens: 0 } };
      return {
        assistantText: "Got it — what's your target comp?",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    });

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "ok",
      session: baseSession({ stage: "identity" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(result.assistantText).toBe("Got it — what's your target comp?");
  });

  it("FIX-1: a non-empty stage-transition turn that only acknowledges (no question) gets the next question appended", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "Good, moving on.",
      toolCalls: [{ name: "record_resume", input: { cv_markdown: "# CV" } }],
      usage: { inputTokens: 40, outputTokens: 10 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "This is good.",
      session: baseSession({ stage: "resume" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    // record_resume advances resume -> identity; the repaired turn must
    // still contain the original acknowledgment AND end with a question.
    expect(result.stage).toBe("identity");
    expect(result.assistantText).toContain("Good, moving on.");
    expect(result.assistantText).toContain("?");
    expect(result.assistantText).toMatch(/logistics|salary floor/i);

    const savedMessages = (saveSessionMock.mock.calls[0][2] as { messages: ChatMessage[] }).messages;
    expect(savedMessages.at(-1)?.content).toBe(result.assistantText);
  });

  it("FIX-1: does not append a fallback question once the interview is done (finish_interview turn)", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "All set!",
      toolCalls: [{ name: "finish_interview", input: {} }],
      usage: { inputTokens: 20, outputTokens: 5 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
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
    expect(result.assistantText).toBe("All set!");
  });

  it("short-circuits (no Anthropic call, no ledger row) once the session is already complete", async () => {
    const runTurn = vi.fn();

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
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
