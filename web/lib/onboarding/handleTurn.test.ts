import { describe, expect, it, vi, beforeEach } from "vitest";
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

const { handleOnboardingTurn, RESUME_SKIP_MESSAGE } = await import("./handleTurn");

const fakeClient = {} as never;

function baseSession(overrides: Partial<Parameters<typeof handleOnboardingTurn>[0]["session"]> = {}) {
  return {
    stage: "resume" as const,
    messages: [],
    extracted: {},
    status: "in_progress" as const,
    modules: {},
    ...overrides,
  };
}

describe("handleOnboardingTurn", () => {
  beforeEach(() => {
    saveSessionMock.mockClear();
    upsertProfileDocMock.mockClear();
    recordOnboardingTurnMock.mockClear();
  });

  it("records exactly one budget_ledger row per LLM call (single-call turn)", async () => {
    // The reply contains a question, so the v2 continue re-prompt does NOT
    // fire — exactly one model call, exactly one ledger row.
    const runTurn = vi.fn(async () => ({
      assistantText: "Thanks — tell me about your background?",
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

    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ userId: "user-1", inputTokens: 100, outputTokens: 50 })
    );
  });

  it("v2 loop fix: a question-less turn triggers ONE continue re-prompt, and BOTH calls get ledger rows", async () => {
    const runTurn = vi
      .fn()
      .mockResolvedValueOnce({
        // Ack-only turn: no question mark -> the re-prompt must fire.
        assistantText: "Got it — that gives real shape to direction.",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 40 },
      })
      .mockResolvedValueOnce({
        // The model continues properly on the nudge.
        assistantText: "Which of those directions would you pick first?",
        toolCalls: [],
        usage: { inputTokens: 120, outputTokens: 30 },
      });

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "I'd want roles applying frontier AI across my interest areas.",
      session: baseSession({ stage: "targeting" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(runTurn).toHaveBeenCalledTimes(2);
    // The synthetic continue nudge is never persisted to history.
    const secondCallHistory = runTurn.mock.calls[1]![0] as ChatMessage[];
    expect(secondCallHistory[secondCallHistory.length - 1]!.content).toContain("Continue");
    const savedMessages = (saveSessionMock.mock.calls[0]![2] as { messages: ChatMessage[] }).messages;
    expect(savedMessages.some((m) => m.content.includes("(Continue"))).toBe(false);
    // Combined text = ack + the model's own follow-up question, no canned append.
    expect(result.assistantText).toBe(
      "Got it — that gives real shape to direction. Which of those directions would you pick first?"
    );
    // Constitutional: one ledger row per real LLM call — two calls, two rows.
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(2);
    expect(recordOnboardingTurnMock).toHaveBeenNthCalledWith(
      1,
      fakeClient,
      expect.objectContaining({ inputTokens: 100, outputTokens: 40 })
    );
    expect(recordOnboardingTurnMock).toHaveBeenNthCalledWith(
      2,
      fakeClient,
      expect.objectContaining({ inputTokens: 120, outputTokens: 30 })
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
      session: baseSession({ stage: "targeting" }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(result.done).toBe(false);
    // ONB-A: record_identity now fires during targeting (not a separate
    // identity stage) and no longer advances the stage itself.
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
      session: baseSession({ stage: "targeting" }),
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

  it("ONB-A: no longer prepends anything on an empty session.messages — calibration generation now owns the opener", async () => {
    const runTurn = vi.fn(async (_history: ChatMessage[]) => ({
      assistantText: "Got it — have a resume handy?",
      toolCalls: [],
      usage: { inputTokens: 30, outputTokens: 15 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "here are my four answers",
      session: baseSession({ stage: "calibration", messages: [] }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(runTurn).toHaveBeenCalledTimes(1);
    const historyArg = runTurn.mock.calls[0][0];
    expect(historyArg).toEqual([{ role: "user", content: "here are my four answers" }]);
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
  });

  it("FIX-1: retries once on an empty assistant response, then falls back to a deterministic stage-appropriate question if still empty", async () => {
    const runTurn = vi
      .fn()
      .mockResolvedValueOnce({ assistantText: "", toolCalls: [], usage: { inputTokens: 5, outputTokens: 0 } })
      .mockResolvedValueOnce({ assistantText: "", toolCalls: [], usage: { inputTokens: 6, outputTokens: 0 } });

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "ok",
      session: baseSession({ stage: "targeting" }),
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

    // INTSIM live-run fix: BOTH real calls get their own budget_ledger row —
    // the empty first attempt's tokens were real spend and must not be
    // dropped just because its text never reached the user. Matches the
    // "one ledger row per real LLM call, constitutional" rule the v2
    // continue-reprompt path already honors above.
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(2);
    expect(recordOnboardingTurnMock).toHaveBeenNthCalledWith(
      1,
      fakeClient,
      expect.objectContaining({ inputTokens: 5, outputTokens: 0 })
    );
    expect(recordOnboardingTurnMock).toHaveBeenNthCalledWith(
      2,
      fakeClient,
      expect.objectContaining({ inputTokens: 6, outputTokens: 0 })
    );
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
      session: baseSession({ stage: "targeting" }),
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
      session: baseSession({ stage: "targeting" }),
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

    // ONB-A: record_resume now advances resume -> targeting directly; the
    // repaired turn must still contain the original acknowledgment AND end
    // with a question.
    expect(result.stage).toBe("targeting");
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

  describe("ONB-A: resume-skip sentinel", () => {
    it("skips with zero LLM calls and zero ledger rows, advancing resume -> targeting", async () => {
      const runTurn = vi.fn();

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: RESUME_SKIP_MESSAGE,
        session: baseSession({ stage: "resume" }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(runTurn).not.toHaveBeenCalled();
      expect(recordOnboardingTurnMock).not.toHaveBeenCalled();
      expect(result.stage).toBe("targeting");
      expect(result.done).toBe(false);
      expect(result.assistantText).toContain("?");
    });

    it("never persists the raw sentinel string as the visible user turn", async () => {
      const runTurn = vi.fn();

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: RESUME_SKIP_MESSAGE,
        session: baseSession({ stage: "resume" }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      const savedMessages = (saveSessionMock.mock.calls[0][2] as { messages: ChatMessage[] }).messages;
      expect(savedMessages.some((m) => m.content === RESUME_SKIP_MESSAGE)).toBe(false);
    });

    it("does not trigger outside the resume stage — the same text at another stage goes to the model normally", async () => {
      const runTurn = vi.fn(async () => ({
        assistantText: "Got it — what's your target comp?",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 10 },
      }));

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: RESUME_SKIP_MESSAGE,
        session: baseSession({ stage: "targeting" }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(runTurn).toHaveBeenCalledTimes(1);
    });
  });

  it("ONB-A: the calibration stage's empty-reply fallback uses the first generated calibration prompt", async () => {
    const runTurn = vi.fn(async () => ({
      assistantText: "",
      toolCalls: [],
      usage: { inputTokens: 5, outputTokens: 0 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "here are my answers",
      session: baseSession({
        stage: "calibration",
        extracted: { calibration: { prompts: ["Tell me about a hard bug.", "b", "c", "d"] } },
      }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(result.assistantText).toBe("Tell me about a hard bug.");
  });

  describe("V3A-B2: module-completion glue", () => {
    it("marks range complete with receipt '4 answers' when record_calibration fires", async () => {
      const runTurn = vi.fn(async () => ({
        assistantText: "Got it — have a resume handy?",
        toolCalls: [
          {
            name: "record_calibration",
            input: { skills: ["a"], evidence: ["b"], range_statement: "c", background_summary: "d" },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 10 },
      }));

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "here are my four answers",
        session: baseSession({ stage: "calibration" }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(saveSessionMock).toHaveBeenCalledWith(
        fakeClient,
        "user-1",
        expect.objectContaining({
          modules: expect.objectContaining({ range: expect.objectContaining({ receipt: "4 answers" }) }),
        })
      );
    });

    it("marks evidence complete with receipt 'resume added' when record_resume fires", async () => {
      const runTurn = vi.fn(async () => ({
        assistantText: "Got it — logistics next.",
        toolCalls: [{ name: "record_resume", input: { cv_markdown: "# CV" } }],
        usage: { inputTokens: 10, outputTokens: 10 },
      }));

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "here is my resume",
        session: baseSession({ stage: "resume" }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      const savedArg = saveSessionMock.mock.calls[0][2] as { modules: Record<string, { receipt: string }> };
      expect(savedArg.modules.evidence?.receipt).toBe("resume added");
    });

    it("resume-skip path marks evidence complete with receipt 'built from your answers'", async () => {
      const runTurn = vi.fn();

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: RESUME_SKIP_MESSAGE,
        session: baseSession({ stage: "resume" }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      const savedArg = saveSessionMock.mock.calls[0][2] as { modules: Record<string, { receipt: string }> };
      expect(savedArg.modules.evidence?.receipt).toBe("built from your answers");
    });

  });

  describe("INTSIM task 4: fallback_kind telemetry", () => {
    it("fallback_kind is undefined on a normal turn (question present, no fallback fired)", async () => {
      const runTurn = vi.fn(async () => ({
        assistantText: "Thanks — tell me about your background?",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      }));

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "here is my resume",
        session: baseSession(),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(result.fallback_kind).toBeUndefined();
    });

    it("sets fallback_kind to 'reprompt' when the v2 continue re-prompt fires, and warns a structured line", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const runTurn = vi
        .fn()
        .mockResolvedValueOnce({
          assistantText: "Got it — that gives real shape to direction.",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 40 },
        })
        .mockResolvedValueOnce({
          assistantText: "Which of those directions would you pick first?",
          toolCalls: [],
          usage: { inputTokens: 120, outputTokens: 30 },
        });

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "I'd want roles applying frontier AI across my interest areas.",
        session: baseSession({ stage: "targeting" }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(result.fallback_kind).toBe("reprompt");
      expect(warnSpy).toHaveBeenCalledWith(
        "onboarding_fallback",
        expect.objectContaining({ userId: "user-1", stage: "targeting", kind: "reprompt" })
      );
      warnSpy.mockRestore();
    });

    it("sets fallback_kind to 'fallback' when the empty-response retry survives (still empty)", async () => {
      const runTurn = vi.fn(async () => ({
        assistantText: "",
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 0 },
      }));

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "ok",
        session: baseSession({ stage: "targeting" }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(result.fallback_kind).toBe("fallback");
    });

    it("sets fallback_kind to 'fallback' on the first last-resort append (non-empty ack-only turn)", async () => {
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

      expect(result.fallback_kind).toBe("fallback");
    });

    it("sets fallback_kind to 'loop_breaker' when the same canned fallback would repeat consecutively", async () => {
      // The prior assistant turn already ends with the canned targeting
      // fallback text (session-prompt 45's second live loop) — a new
      // ack-only turn must get the loop-breaker question, not the same
      // canned text again.
      const priorFallback =
        "Logistics, all in one go: where are you based, remote-only or is some onsite fine (and where), " +
        "and what's the salary floor below which you won't even look?";
      const runTurn = vi.fn(async () => ({
        assistantText: "Noted, thanks.",
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 10 },
      }));

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "here's more context",
        session: baseSession({
          stage: "targeting",
          messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: priorFallback },
          ],
        }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(result.fallback_kind).toBe("loop_breaker");
      expect(result.assistantText).toContain("What's the one thing I haven't asked about that matters most");
    });
  });

  describe("V3A-B2: module-completion glue", () => {
    it("preserves session.modules unchanged in saveSession when a turn fires neither record_calibration nor record_resume", async () => {
      const runTurn = vi.fn(async () => ({
        assistantText: "Got it — what's your target comp?",
        toolCalls: [{ name: "record_identity", input: { name: "Alex", email: "alex@example.com" } }],
        usage: { inputTokens: 10, outputTokens: 10 },
      }));

      const existingModules = { anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "SWE · Acme" } };

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "Alex, alex@example.com",
        session: baseSession({ stage: "targeting", modules: existingModules }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(saveSessionMock).toHaveBeenCalledWith(
        fakeClient,
        "user-1",
        expect.objectContaining({ modules: existingModules })
      );
    });
  });
});
