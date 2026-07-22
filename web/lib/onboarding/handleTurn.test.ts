import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatMessage } from "../anthropic/interview";
import type { ExtractedState } from "../profile/buildDoc";

const saveSessionMock = vi.fn(async (..._args: unknown[]) => {});
const upsertProfileDocMock = vi.fn(async (_supabase: unknown, _userId: string, _doc: Record<string, string>) => ({
  status: "valid" as const,
  errors: [] as string[],
}));
const recordOnboardingTurnMock = vi.fn(async (..._args: unknown[]) => {});
const seedUserPortalsMock = vi.fn(async (..._args: unknown[]) => ({
  dreamCompaniesCount: 0,
  tierPackCount: 0,
  couldntAutoFind: [] as string[],
  remoteRequired: false,
  remoteRequiredSource: "regex fallback" as const,
}));

vi.mock("../db/onboardingSession", () => ({ saveSession: saveSessionMock }));
vi.mock("../db/profiles", () => ({ upsertProfileDoc: upsertProfileDocMock }));
vi.mock("../db/ledger", () => ({ recordOnboardingTurn: recordOnboardingTurnMock }));
vi.mock("../profile/seedUserPortals", () => ({ seedUserPortals: seedUserPortalsMock }));

const { handleOnboardingTurn, RESUME_SKIP_MESSAGE } = await import("./handleTurn");

const fakeClient = {} as never;

// currentIntent resolves to "calibration" from just this.
const ANCHOR_ONLY: ExtractedState = { anchor: { current_title: "Staff Engineer", current_company: "Acme" } };

// currentIntent resolves to "resume".
const CALIBRATION_DONE: ExtractedState = {
  ...ANCHOR_ONLY,
  calibration: { skills: ["Go"], evidence: ["Shipped a thing"], range_statement: "r", background_summary: "b" },
};

// currentIntent resolves to "identity".
const RESUME_DONE: ExtractedState = { ...CALIBRATION_DONE, resumeResolved: true };

// currentIntent resolves to "targeting" — nothing else missing after it.
const IDENTITY_DONE: ExtractedState = {
  ...RESUME_DONE,
  identity: { name: "Alex", email: "alex@example.com", location_and_compensation: { base: "Denver, CO" } },
};

function baseSession(overrides: Partial<Parameters<typeof handleOnboardingTurn>[0]["session"]> = {}) {
  return {
    stage: "resume" as const,
    messages: [] as ChatMessage[],
    extracted: RESUME_DONE,
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
    seedUserPortalsMock.mockClear();
    seedUserPortalsMock.mockResolvedValue({
      dreamCompaniesCount: 0,
      tierPackCount: 0,
      couldntAutoFind: [],
      remoteRequired: false,
      remoteRequiredSource: "regex fallback",
    });
  });

  it("records exactly one budget_ledger row per LLM call when the target resolves cleanly", async () => {
    const runTurn = vi.fn(async () => ({
      question: "Logistics, all in one go: where are you based?",
      extractedUpdates: { identity: { name: "Alex", location_and_compensation: { base: "Denver, CO" } } },
      usage: { inputTokens: 100, outputTokens: 50 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "Alex, based in Denver",
      session: baseSession({ extracted: RESUME_DONE }),
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
    expect(result.done).toBe(false);
    expect(result.fallback_kind).toBeUndefined();
  });

  it("passes the server-computed currentIntent/nextIntent to runTurn (server picks the target, not the model)", async () => {
    const runTurn = vi.fn(async () => ({
      question: "Have a resume handy?",
      extractedUpdates: { calibration: { skills: ["a"], evidence: ["b"], range_statement: "c", background_summary: "d" } },
      usage: { inputTokens: 10, outputTokens: 10 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "here are my four answers",
      session: baseSession({ extracted: ANCHOR_ONLY }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(runTurn).toHaveBeenCalledWith(
      expect.objectContaining({ currentIntent: "calibration", nextIntent: "resume", extracted: ANCHOR_ONLY })
    );
  });

  it("engine contract point 4a: an empty question retries exactly once, then falls back to the deterministic askHint for the real next target — both calls ledgered", async () => {
    // Extraction succeeds both times (identity resolves), but the model
    // never phrases a question — this must fall to "retry_exhausted"
    // (targeting, the real next target), not "no_progress" (identity
    // itself resolved cleanly, so it's not the loop-breaker case).
    const runTurn = vi
      .fn()
      .mockResolvedValueOnce({
        question: "",
        extractedUpdates: { identity: { name: "Alex", location_and_compensation: { base: "Denver, CO" } } },
        usage: { inputTokens: 5, outputTokens: 0 },
      })
      .mockResolvedValueOnce({
        question: "",
        extractedUpdates: { identity: { name: "Alex", location_and_compensation: { base: "Denver, CO" } } },
        usage: { inputTokens: 6, outputTokens: 0 },
      });

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "ok",
      session: baseSession({ extracted: RESUME_DONE }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(result.assistantText.trim()).not.toBe("");
    expect(result.fallback_kind).toBe("retry_exhausted");
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(2);
    expect(recordOnboardingTurnMock).toHaveBeenNthCalledWith(1, fakeClient, expect.objectContaining({ inputTokens: 5, outputTokens: 0 }));
    expect(recordOnboardingTurnMock).toHaveBeenNthCalledWith(2, fakeClient, expect.objectContaining({ inputTokens: 6, outputTokens: 0 }));
  });

  it("recovers if the retry attempt returns real text (uses the retry's text, not the fallback)", async () => {
    let call = 0;
    const runTurn = vi.fn(async () => {
      call += 1;
      if (call === 1) return { question: "", extractedUpdates: {}, usage: { inputTokens: 5, outputTokens: 0 } };
      return {
        question: "What's your target comp?",
        extractedUpdates: { identity: { name: "Alex", location_and_compensation: { base: "Denver, CO" } } },
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    });

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "ok",
      session: baseSession({ extracted: RESUME_DONE }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(result.assistantText).toBe("What's your target comp?");
    expect(result.fallback_kind).toBeUndefined();
  });

  describe("engine contract point 4b (Fix B, session 57: two-strike threshold + anti-repeat alternation)", () => {
    it("the FIRST non-advancing round on an intent keeps the model's own (premature) phrasing — no override", async () => {
      const runTurn = vi.fn(async () => ({
        // The model asked about something else entirely instead of making
        // progress on identity — a non-empty but premature question.
        question: "Which of those directions would you pick first?",
        extractedUpdates: {},
        usage: { inputTokens: 40, outputTokens: 10 },
      }));

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "not sure yet",
        session: baseSession({ extracted: RESUME_DONE }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(runTurn).toHaveBeenCalledTimes(1);
      expect(result.fallback_kind).toBeUndefined();
      expect(result.assistantText).toBe("Which of those directions would you pick first?");
    });

    it("the SECOND consecutive non-advancing round on the same intent overrides with the deterministic askHint", async () => {
      const runTurn = vi.fn(async () => ({
        question: "Which of those directions would you pick first?",
        extractedUpdates: {},
        usage: { inputTokens: 40, outputTokens: 10 },
      }));

      const stuckOnce: ExtractedState = {
        ...RESUME_DONE,
        turn_log: [
          {
            intent_keys: ["identity"],
            retry_used: false,
            askhint_fallback_used: false,
            input_tokens: 40,
            output_tokens: 10,
            ts: "2026-01-01T00:00:00.000Z",
            target_intent: "identity",
            intent_advanced: false,
          },
        ],
      };

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "still not sure",
        session: baseSession({ extracted: stuckOnce }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(runTurn).toHaveBeenCalledTimes(1);
      expect(result.fallback_kind).toBe("no_progress");
      expect(result.assistantText).not.toBe("Which of those directions would you pick first?");
      expect(result.assistantText).toMatch(/logistics|name/i);
    });

    // Fix D (session 58) supersedes the old round-3-onward "alternation"
    // continuation below: previously round 3 kept the model's own phrasing
    // and round 4 fired the template again, tolerating up to 6 stuck rounds
    // before PROGRESS would eventually fail the run. The bounded-deferral
    // backstop now gives up after the 3rd consecutive stuck round instead —
    // "a stuck interview ends bounded and honest, never loops to the turn
    // cap" (session-prompts/58).
    it("Fix D: the 3RD consecutive stuck round defers the intent instead of continuing the old alternation cycle", async () => {
      const runTurn = vi.fn(async () => ({
        question: "Which of those directions would you pick first?",
        extractedUpdates: {},
        usage: { inputTokens: 40, outputTokens: 10 },
      }));

      // Round 1 stuck (no template), round 2 stuck (template fired) — this
      // turn is round 3.
      const stuckTwiceTemplateJustFired: ExtractedState = {
        ...RESUME_DONE,
        turn_log: [
          {
            intent_keys: ["identity"],
            retry_used: false,
            askhint_fallback_used: false,
            input_tokens: 40,
            output_tokens: 10,
            ts: "2026-01-01T00:00:00.000Z",
            target_intent: "identity",
            intent_advanced: false,
          },
          {
            intent_keys: ["identity"],
            retry_used: false,
            askhint_fallback_used: true,
            input_tokens: 40,
            output_tokens: 10,
            ts: "2026-01-01T00:01:00.000Z",
            target_intent: "identity",
            intent_advanced: false,
          },
        ],
      };

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "still not sure",
        session: baseSession({ extracted: stuckTwiceTemplateJustFired }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(result.fallback_kind).toBe("no_progress");
      expect(result.assistantText).not.toBe("Which of those directions would you pick first?");

      const saved = saveSessionMock.mock.calls[0][2] as {
        extracted: { deferred_intents?: string[]; turn_log?: { deferred?: boolean }[] };
      };
      expect(saved.extracted.deferred_intents).toEqual(["identity"]);
      expect(saved.extracted.turn_log?.[2]).toMatchObject({ target_intent: "identity", deferred: true });
    });

    it("Fix D: the bound is >= 3, not exactly 3 — a 4th stuck round with no prior deferral marker also defers immediately", async () => {
      const runTurn = vi.fn(async () => ({
        question: "Which of those directions would you pick first?",
        extractedUpdates: {},
        usage: { inputTokens: 40, outputTokens: 10 },
      }));

      // A hand-constructed edge case that wouldn't arise from real usage
      // (round 3 would already have deferred and stopped targeting
      // "identity") — asserts the threshold check is >=3, not a one-shot
      // ===3 opportunity.
      const priorEntries = [
        { askhint_fallback_used: false, ts: "2026-01-01T00:00:00.000Z" },
        { askhint_fallback_used: true, ts: "2026-01-01T00:01:00.000Z" },
        { askhint_fallback_used: false, ts: "2026-01-01T00:02:00.000Z" },
      ].map((e) => ({
        intent_keys: ["identity"],
        retry_used: false,
        input_tokens: 40,
        output_tokens: 10,
        target_intent: "identity",
        intent_advanced: false,
        ...e,
      }));

      const stuckThrice: ExtractedState = { ...RESUME_DONE, turn_log: priorEntries };

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "still not sure",
        session: baseSession({ extracted: stuckThrice }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(result.fallback_kind).toBe("no_progress");
      expect(result.assistantText).not.toBe("Which of those directions would you pick first?");

      const saved = saveSessionMock.mock.calls[0][2] as { extracted: { deferred_intents?: string[] } };
      expect(saved.extracted.deferred_intents).toEqual(["identity"]);
    });
  });

  it("engine contract point 5: anything_else opportunistically merges fields outside this turn's target", async () => {
    const runTurn = vi.fn(async () => ({
      question: "Have a resume handy?",
      extractedUpdates: {
        calibration: { skills: ["a"], evidence: ["b"], range_statement: "c", background_summary: "d" },
        anything_else: { identity: { name: "Alex Quinn" } },
      },
      usage: { inputTokens: 10, outputTokens: 10 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "here are my four answers, by the way I'm Alex Quinn",
      session: baseSession({ extracted: ANCHOR_ONLY }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    const saved = saveSessionMock.mock.calls[0][2] as { extracted: { identity?: { name?: string } } };
    expect(saved.extracted.identity?.name).toBe("Alex Quinn");
  });

  it("saves the session as in_progress and does not upsert a profile mid-interview", async () => {
    const runTurn = vi.fn(async () => ({
      question: "What's your target comp?",
      extractedUpdates: { identity: { name: "A", location_and_compensation: { base: "X" } } },
      usage: { inputTokens: 10, outputTokens: 10 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "Alex, alex@example.com",
      session: baseSession({ extracted: RESUME_DONE }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(result.done).toBe(false);
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
    expect(saveSessionMock).toHaveBeenCalledWith(fakeClient, "user-1", expect.objectContaining({ status: "in_progress" }));
  });

  it("overwrites a model-supplied (bogus) identity email with deps.userEmail, unconditionally", async () => {
    const runTurn = vi.fn(async () => ({
      question: "What's your target comp?",
      extractedUpdates: {
        identity: { name: "Alex", email: "totally-made-up@nowhere.invalid", location_and_compensation: { base: "Denver" } },
      },
      usage: { inputTokens: 10, outputTokens: 10 },
    }));

    await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "real-auth-email@example.com",
      userMessage: "Alex, totally-made-up@nowhere.invalid",
      session: baseSession({ extracted: RESUME_DONE }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    const savedArg = saveSessionMock.mock.calls[0][2] as { extracted: { identity?: { email?: string } } };
    expect(savedArg.extracted.identity?.email).toBe("real-auth-email@example.com");
    expect(savedArg.extracted.identity?.email).not.toBe("totally-made-up@nowhere.invalid");
  });

  it("builds and upserts the profile doc once the checklist fully resolves, and marks the session complete", async () => {
    const runTurn = vi.fn(async () => ({
      question: "All set — head to your feed and hit \"Run my hunt\" to get your first results.",
      extractedUpdates: {
        targeting: { tiers: [{ key: "tier_1", label: "Backend engineering" }], thesis_summary: "Wants backend roles." },
      },
      usage: { inputTokens: 20, outputTokens: 5 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "yes that's everything",
      session: baseSession({ extracted: IDENTITY_DONE }),
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

  it("ADM-3 Part 0: the completion turn seeds portals exactly once, after the profile doc upsert", async () => {
    const runTurn = vi.fn(async () => ({
      question: "All set!",
      extractedUpdates: {
        targeting: { tiers: [{ key: "tier_1", label: "Backend engineering" }], thesis_summary: "Wants backend roles." },
      },
      usage: { inputTokens: 20, outputTokens: 5 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "yes that's everything",
      session: baseSession({ extracted: IDENTITY_DONE }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(result.done).toBe(true);
    expect(seedUserPortalsMock).toHaveBeenCalledTimes(1);
    expect(seedUserPortalsMock).toHaveBeenCalledWith(fakeClient, "user-1");
    const upsertOrder = upsertProfileDocMock.mock.invocationCallOrder[0];
    const saveOrder = saveSessionMock.mock.invocationCallOrder[0];
    const seedOrder = seedUserPortalsMock.mock.invocationCallOrder[0];
    expect(seedOrder).toBeGreaterThan(upsertOrder);
    expect(seedOrder).toBeGreaterThan(saveOrder);
  });

  it("ADM-3 Part 0: a seeding failure is fail-open — the completion turn still returns done:true", async () => {
    seedUserPortalsMock.mockRejectedValueOnce(new Error("board_catalog read failed"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const runTurn = vi.fn(async () => ({
      question: "All set!",
      extractedUpdates: {
        targeting: { tiers: [{ key: "tier_1", label: "Backend engineering" }], thesis_summary: "Wants backend roles." },
      },
      usage: { inputTokens: 20, outputTokens: 5 },
    }));

    const result = await handleOnboardingTurn({
      userId: "user-1",
      userEmail: "user-1@example.com",
      userMessage: "yes that's everything",
      session: baseSession({ extracted: IDENTITY_DONE }),
      supabase: fakeClient,
      admin: fakeClient,
      runTurn,
    });

    expect(result.done).toBe(true);
    expect(result.validation?.status).toBe("valid");
    expect(consoleErrorSpy).toHaveBeenCalledWith("onboarding seedUserPortals failed", expect.objectContaining({ userId: "user-1" }));
    consoleErrorSpy.mockRestore();
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
    it("skips with zero LLM calls and zero ledger rows, advancing straight past the resume step", async () => {
      const runTurn = vi.fn();

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: RESUME_SKIP_MESSAGE,
        session: baseSession({ stage: "resume", extracted: CALIBRATION_DONE }),
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
        session: baseSession({ stage: "resume", extracted: CALIBRATION_DONE }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      const savedMessages = (saveSessionMock.mock.calls[0][2] as { messages: ChatMessage[] }).messages;
      expect(savedMessages.some((m) => m.content === RESUME_SKIP_MESSAGE)).toBe(false);
    });

    it("does not trigger outside the resume stage — the same text at another stage goes to the model normally", async () => {
      const runTurn = vi.fn(async () => ({
        question: "What's your target comp?",
        extractedUpdates: { targeting: { tiers: [{ key: "tier_1", label: "x" }], thesis_summary: "t" } },
        usage: { inputTokens: 10, outputTokens: 10 },
      }));

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: RESUME_SKIP_MESSAGE,
        session: baseSession({ stage: "targeting", extracted: IDENTITY_DONE }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(runTurn).toHaveBeenCalledTimes(1);
    });

    it("resume-skip path marks evidence complete with receipt 'built from your answers'", async () => {
      const runTurn = vi.fn();

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: RESUME_SKIP_MESSAGE,
        session: baseSession({ stage: "resume", extracted: CALIBRATION_DONE }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      const savedArg = saveSessionMock.mock.calls[0][2] as { modules: Record<string, { receipt: string }> };
      expect(savedArg.modules.evidence?.receipt).toBe("built from your answers");
    });
  });

  describe("module-completion glue", () => {
    it("marks range complete with receipt '4 answers' when calibration resolves via the engine turn", async () => {
      const runTurn = vi.fn(async () => ({
        question: "Have a resume handy?",
        extractedUpdates: { calibration: { skills: ["a"], evidence: ["b"], range_statement: "c", background_summary: "d" } },
        usage: { inputTokens: 10, outputTokens: 10 },
      }));

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "here are my four answers",
        session: baseSession({ extracted: ANCHOR_ONLY }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(saveSessionMock).toHaveBeenCalledWith(
        fakeClient,
        "user-1",
        expect.objectContaining({ modules: expect.objectContaining({ range: expect.objectContaining({ receipt: "4 answers" }) }) })
      );
    });

    it("marks evidence complete with receipt 'resume added' when resume resolves via the engine turn", async () => {
      const runTurn = vi.fn(async () => ({
        question: "Logistics next.",
        extractedUpdates: { resume: { cv_markdown: "# CV" } },
        usage: { inputTokens: 10, outputTokens: 10 },
      }));

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "here is my resume",
        session: baseSession({ extracted: CALIBRATION_DONE }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      const savedArg = saveSessionMock.mock.calls[0][2] as { modules: Record<string, { receipt: string }> };
      expect(savedArg.modules.evidence?.receipt).toBe("resume added");
    });

    it("preserves session.modules unchanged when neither calibration nor resume resolves this turn", async () => {
      const runTurn = vi.fn(async () => ({
        question: "What's your target comp?",
        extractedUpdates: { identity: { name: "Alex", location_and_compensation: { base: "Denver" } } },
        usage: { inputTokens: 10, outputTokens: 10 },
      }));

      const existingModules = { anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "SWE · Acme" } };

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "Alex, Denver",
        session: baseSession({ extracted: RESUME_DONE, modules: existingModules }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(saveSessionMock).toHaveBeenCalledWith(fakeClient, "user-1", expect.objectContaining({ modules: existingModules }));
    });
  });

  describe("engine contract point 7: turn_log telemetry", () => {
    it("appends one turn_log entry with intent_keys/retry_used/askhint_fallback_used/token totals", async () => {
      const runTurn = vi.fn(async () => ({
        question: "What's your target comp?",
        extractedUpdates: { identity: { name: "Alex", location_and_compensation: { base: "Denver" } } },
        usage: { inputTokens: 100, outputTokens: 50 },
      }));

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "Alex, Denver",
        session: baseSession({ extracted: RESUME_DONE }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      const saved = saveSessionMock.mock.calls[0][2] as { extracted: { turn_log?: unknown[] } };
      expect(saved.extracted.turn_log).toHaveLength(1);
      expect(saved.extracted.turn_log?.[0]).toMatchObject({
        intent_keys: expect.arrayContaining(["identity"]),
        retry_used: false,
        askhint_fallback_used: false,
        input_tokens: 100,
        output_tokens: 50,
      });
    });

    it("sums token totals across both calls when a retry fires", async () => {
      const runTurn = vi
        .fn()
        .mockResolvedValueOnce({ question: "", extractedUpdates: {}, usage: { inputTokens: 5, outputTokens: 0 } })
        .mockResolvedValueOnce({ question: "", extractedUpdates: {}, usage: { inputTokens: 6, outputTokens: 1 } });

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "ok",
        session: baseSession({ extracted: IDENTITY_DONE }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      const saved = saveSessionMock.mock.calls[0][2] as { extracted: { turn_log?: Record<string, unknown>[] } };
      expect(saved.extracted.turn_log?.[0]).toMatchObject({ retry_used: true, input_tokens: 11, output_tokens: 1 });
    });
  });

  describe("Fix D (session 58): bounded deferral backstop", () => {
    const stuckTwiceOnIdentity = [
      { askhint_fallback_used: false, ts: "2026-01-01T00:00:00.000Z" },
      { askhint_fallback_used: true, ts: "2026-01-01T00:01:00.000Z" },
    ].map((e) => ({
      intent_keys: ["identity"],
      retry_used: false,
      input_tokens: 40,
      output_tokens: 10,
      target_intent: "identity",
      intent_advanced: false,
      ...e,
    }));

    it("deferring a non-last intent moves on to the next required intent instead of re-asking the deferred one", async () => {
      const runTurn = vi.fn(async () => ({
        question: "Which of those directions would you pick first?",
        extractedUpdates: {},
        usage: { inputTokens: 40, outputTokens: 10 },
      }));

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "still not sure",
        session: baseSession({ extracted: { ...RESUME_DONE, turn_log: stuckTwiceOnIdentity } }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(result.done).toBe(false);
      // targeting is the only thing left once identity defers — its
      // deterministic ask text always mentions "directions"/"optimizing".
      expect(result.assistantText).toMatch(/direction|optimizing/i);
    });

    it("deferring the LAST remaining required intent ends the interview bounded — done:true this same turn, no extra round-trip", async () => {
      const runTurn = vi.fn(async () => ({
        question: "Which of those directions would you pick first?",
        extractedUpdates: {},
        usage: { inputTokens: 40, outputTokens: 10 },
      }));

      const onlyIdentityMissing: ExtractedState = {
        ...CALIBRATION_DONE,
        resumeResolved: true,
        targeting: { tiers: [{ key: "tier_1", label: "Backend" }], thesis_summary: "t", hard_disqualifiers: [], soft_concerns: [] },
        turn_log: stuckTwiceOnIdentity,
      };

      const result = await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "still not sure",
        session: baseSession({ extracted: onlyIdentityMissing }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(result.done).toBe(true);
      expect(result.assistantText).toBe(
        'Your profile is built — head to your feed and hit "Run my hunt" to get your first results.'
      );
      expect(upsertProfileDocMock).toHaveBeenCalledTimes(1);

      const saved = saveSessionMock.mock.calls[0][2] as { status: string; extracted: { deferred_intents?: string[] } };
      expect(saved.status).toBe("complete");
      expect(saved.extracted.deferred_intents).toEqual(["identity"]);
    });

    it("console.warn fires exactly once, loudly, on the turn deferral happens", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const runTurn = vi.fn(async () => ({ question: "x", extractedUpdates: {}, usage: { inputTokens: 1, outputTokens: 1 } }));

      await handleOnboardingTurn({
        userId: "user-1",
        userEmail: "user-1@example.com",
        userMessage: "still not sure",
        session: baseSession({ extracted: { ...RESUME_DONE, turn_log: stuckTwiceOnIdentity } }),
        supabase: fakeClient,
        admin: fakeClient,
        runTurn,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deferring"), expect.objectContaining({ intent: "identity" }));
      warnSpy.mockRestore();
    });
  });
});
