import { describe, expect, it, vi } from "vitest";
import { SEEDED_GREETING } from "@/lib/anthropic/interview";
import type { ChatMessage } from "@/lib/anthropic/interview";
import {
  buildDisplayMessages,
  computeRailSteps,
  fetchInitialState,
  handleUpload,
  initialOnboardingState,
  onboardingReducer,
  OnboardingView,
  submitTurn,
  validateUploadName,
  type OnboardingState,
} from "./page";

/**
 * This repo's vitest config runs in the `node` environment with no
 * jsdom/@testing-library/react installed (see web/vitest.config.ts and
 * web/package.json — neither is a devDependency, and adding them is out of
 * this task's file boundary). Every other stateful/hook-bearing test in
 * this repo (e.g. lib/onboarding/handleTurn.test.ts) follows the same
 * pattern: extract the business logic into plain, dependency-injected
 * functions and a pure reducer, then test those directly. page.tsx follows
 * that same shape here — `onboardingReducer` owns every state transition
 * the component makes, and `fetchInitialState`/`submitTurn`/`handleUpload`
 * own every network/file interaction — so this file gets full behavioral
 * coverage without needing a DOM renderer.
 *
 * `OnboardingView` (the hook-free presentational half of page.tsx, see the
 * split there) is additionally exercised by *directly invoking it* as a
 * plain function and inspecting the returned element tree — the same
 * direct-invocation style this repo already uses for FileButton
 * (components/ui/FileButton.test.tsx) and the (app) layout
 * (app/(app)/layout.test.tsx). `OnboardingPage` itself keeps the hooks
 * (useReducer/useEffect/useRef) and can't be called this way — calling a
 * hook-using function outside React's render cycle throws — so it stays
 * covered only indirectly, through the reducer/pure-function tests above.
 */

function fakeResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("buildDisplayMessages — seeded greeting rendering", () => {
  it("prepends the seeded greeting locally when messages is empty (fresh session)", () => {
    const result = buildDisplayMessages([]);
    expect(result).toEqual([{ role: "assistant", content: SEEDED_GREETING }]);
  });

  it("does not duplicate the greeting when messages already contains it (resumed session)", () => {
    const persisted: ChatMessage[] = [
      { role: "assistant", content: SEEDED_GREETING },
      { role: "user", content: "I do backend engineering" },
      { role: "assistant", content: "Nice — tell me more." },
    ];
    const result = buildDisplayMessages(persisted);
    expect(result).toBe(persisted);
    expect(result.filter((m) => m.content === SEEDED_GREETING)).toHaveLength(1);
  });
});

describe("fetchInitialState — GET /api/onboarding/state, no POST turn call", () => {
  it("resolves messages/stage/done from a fresh session without ever calling POST turn", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/onboarding/state") {
        return fakeResponse({ stage: "resume", messages: [], status: "in_progress" });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const result = await fetchInitialState(fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ messages: [], stage: "resume", done: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/state");
    // The seeded greeting is purely local decoration on top of this — no
    // extra network call is needed to produce it.
    const displayed = buildDisplayMessages(result.messages);
    expect(displayed).toEqual([{ role: "assistant", content: SEEDED_GREETING }]);
  });

  it("restores a resumed session's full transcript and non-resume stage on mount", async () => {
    const persisted: ChatMessage[] = [
      { role: "assistant", content: SEEDED_GREETING },
      { role: "user", content: "Alex, alex@example.com" },
      { role: "assistant", content: "Got it — what's your target comp?" },
    ];
    const fetchMock = vi.fn(async () =>
      fakeResponse({ stage: "targeting", messages: persisted, status: "in_progress" })
    );

    const result = await fetchInitialState(fetchMock as unknown as typeof fetch);

    expect(result.stage).toBe("targeting");
    expect(result.done).toBe(false);
    const displayed = buildDisplayMessages(result.messages);
    expect(displayed).toEqual(persisted);
    expect(displayed.filter((m) => m.content === SEEDED_GREETING)).toHaveLength(1);

    // And the progress rail reflects the restored (non-resume) stage.
    const assistantCount = displayed.filter((m) => m.role === "assistant").length;
    const rail = computeRailSteps(result.stage, assistantCount);
    expect(rail.find((s) => s.label === "Targeting")?.status).toBe("current");
    expect(rail.find((s) => s.label === "Basics")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Done")?.status).toBe("upcoming");
  });
});

describe("submitTurn / onboardingReducer — failed turn preserves the draft, with retry", () => {
  it("rejects on a non-2xx response and does not touch the composer draft", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ error: "model overloaded" }, false));

    await expect(submitTurn("here is my resume", fetchMock as unknown as typeof fetch)).rejects.toThrow(
      "model overloaded"
    );
  });

  it("rejects when fetch itself throws (network error)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(submitTurn("here is my resume", fetchMock as unknown as typeof fetch)).rejects.toThrow(
      "network down"
    );
  });

  it("turn_failed keeps the typed message in the composer and surfaces the error", () => {
    const afterTyping = onboardingReducer(initialOnboardingState, {
      type: "input_changed",
      value: "here is my resume",
    });
    const afterSendStart = onboardingReducer(afterTyping, { type: "turn_started" });
    expect(afterSendStart.sending).toBe(true);

    const afterFailure = onboardingReducer(afterSendStart, {
      type: "turn_failed",
      error: "Something went wrong.",
    });

    // The draft must survive the failure so Retry can resend it.
    expect(afterFailure.input).toBe("here is my resume");
    expect(afterFailure.sending).toBe(false);
    expect(afterFailure.turnError).toBe("Something went wrong.");
  });

  it("turn_succeeded clears the composer, appends both messages, and clears any prior error", () => {
    const typed = onboardingReducer(initialOnboardingState, { type: "input_changed", value: "hello" });
    const started = onboardingReducer(typed, { type: "turn_started" });
    const failedOnce = onboardingReducer(started, { type: "turn_failed", error: "oops" });

    // Retry: same draft still present, resend succeeds this time.
    expect(failedOnce.input).toBe("hello");
    const retried = onboardingReducer(failedOnce, { type: "turn_started" });
    const succeeded = onboardingReducer(retried, {
      type: "turn_succeeded",
      userMessage: "hello",
      assistantText: "Thanks — tell me more.",
      stage: "resume",
      done: false,
    });

    expect(succeeded.input).toBe("");
    expect(succeeded.turnError).toBe("");
    expect(succeeded.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Thanks — tell me more." },
    ]);
  });

  it("regression: the seeded greeting is still displayed after the first turn_succeeded from an empty transcript", () => {
    // Fresh session: state_loaded sets messages to [] (nothing persisted yet).
    const loaded = onboardingReducer(initialOnboardingState, {
      type: "state_loaded",
      messages: [],
      stage: "resume",
      done: false,
    });
    const typed = onboardingReducer(loaded, { type: "input_changed", value: "I do backend engineering" });
    const started = onboardingReducer(typed, { type: "turn_started" });
    const succeeded = onboardingReducer(started, {
      type: "turn_succeeded",
      userMessage: "I do backend engineering",
      assistantText: "Nice — tell me more.",
      stage: "resume",
      done: false,
    });

    // The optimistic local state is [userMsg, assistantReply] — length 2,
    // non-empty, and NOT starting with the greeting. Before the fix,
    // buildDisplayMessages's emptiness check would treat this as "already
    // has messages" and silently drop the greeting from the transcript.
    expect(succeeded.messages).toEqual([
      { role: "user", content: "I do backend engineering" },
      { role: "assistant", content: "Nice — tell me more." },
    ]);

    const displayed = buildDisplayMessages(succeeded.messages);
    expect(displayed[0]).toEqual({ role: "assistant", content: SEEDED_GREETING });
    expect(displayed).toEqual([
      { role: "assistant", content: SEEDED_GREETING },
      { role: "user", content: "I do backend engineering" },
      { role: "assistant", content: "Nice — tell me more." },
    ]);

    // computeRailSteps must be derived from the corrected (greeting-included)
    // transcript so the rail heuristic isn't undercounted by one.
    const assistantCount = displayed.filter((m) => m.role === "assistant").length;
    expect(assistantCount).toBe(2);
  });
});

describe("handleUpload / validateUploadName — upload rejection", () => {
  it("accepts a .txt file and returns its text", async () => {
    const file = new File(["Alex Quinn resume body"], "resume.txt", { type: "text/plain" });
    const result = await handleUpload(file);
    expect(result).toEqual({ ok: true, text: "Alex Quinn resume body" });
  });

  it("accepts a .md file", async () => {
    expect(validateUploadName("resume.md")).toBeNull();
  });

  it("rejects a disallowed extension with a friendly message and does not read its contents", async () => {
    const file = new File(["binary junk"], "resume.pdf", { type: "application/pdf" });
    const textSpy = vi.spyOn(file, "text");

    const result = await handleUpload(file);

    expect(result).toEqual({ ok: false, error: "Please upload a .txt or .md file." });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("upload_rejected reducer action surfaces the message without populating the composer", () => {
    const next = onboardingReducer(initialOnboardingState, {
      type: "upload_rejected",
      error: "Please upload a .txt or .md file.",
    });
    expect(next.uploadError).toBe("Please upload a .txt or .md file.");
    expect(next.input).toBe("");
  });

  it("upload_accepted reducer action populates the composer and clears any prior upload error", () => {
    const rejected = onboardingReducer(initialOnboardingState, {
      type: "upload_rejected",
      error: "Please upload a .txt or .md file.",
    });
    const accepted = onboardingReducer(rejected, {
      type: "upload_accepted",
      fileName: "resume.txt",
      text: "resume body",
    });
    expect(accepted.uploadError).toBeNull();
    expect(accepted.input).toBe("resume body");
    expect(accepted.fileName).toBe("resume.txt");
  });
});

describe("computeRailSteps — progress rail per stage", () => {
  it("resume stage with <=2 assistant messages: About you current, Resume not reached", () => {
    const rail = computeRailSteps("resume", 1);
    expect(rail.find((s) => s.label === "About you")?.status).toBe("current");
    expect(rail.find((s) => s.label === "Resume")?.status).toBe("upcoming");

    const railAtTwo = computeRailSteps("resume", 2);
    expect(railAtTwo.find((s) => s.label === "About you")?.status).toBe("current");
    expect(railAtTwo.find((s) => s.label === "Resume")?.status).toBe("upcoming");
  });

  it("resume stage with >=3 assistant messages: About you complete, Resume current", () => {
    const rail = computeRailSteps("resume", 3);
    expect(rail.find((s) => s.label === "About you")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Resume")?.status).toBe("current");
    expect(rail.find((s) => s.label === "Basics")?.status).toBe("upcoming");
  });

  it("identity stage maps to Basics current, with About you and Resume complete", () => {
    const rail = computeRailSteps("identity", 5);
    expect(rail.find((s) => s.label === "About you")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Resume")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Basics")?.status).toBe("current");
    expect(rail.find((s) => s.label === "Targeting")?.status).toBe("upcoming");
  });

  it("targeting stage maps to Targeting current, with Basics complete", () => {
    const rail = computeRailSteps("targeting", 8);
    expect(rail.find((s) => s.label === "Basics")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Targeting")?.status).toBe("current");
    expect(rail.find((s) => s.label === "Done")?.status).toBe("upcoming");
  });

  it("done stage maps to Done current, with every prior step complete", () => {
    const rail = computeRailSteps("done", 12);
    expect(rail.find((s) => s.label === "About you")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Resume")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Basics")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Targeting")?.status).toBe("complete");
    expect(rail.find((s) => s.label === "Done")?.status).toBe("current");
  });
});

/**
 * OnboardingView — presentational tree, direct invocation.
 *
 * OnboardingView is the hook-free half of page.tsx (see the split there):
 * it takes plain data + callback props and returns the JSX tree, with no
 * useReducer/useEffect/useRef of its own. That means it can be called
 * directly as a plain function — `OnboardingView({...props})` — and its
 * returned React element tree inspected via `.props`, exactly like this
 * repo's FileButton.test.tsx and (app)/layout.test.tsx already do for their
 * own hook-free components. `OnboardingPage` itself still can't be tested
 * this way (calling a hook-using function outside React's render cycle
 * throws), which is why it stays covered only through the reducer /
 * pure-function tests above.
 */
function railBadges(view: ReturnType<typeof OnboardingView>) {
  const [, railRow] = view.props.children;
  return railRow.props.children.map((item: (typeof railRow.props.children)[number]) => item.props.children[0]);
}

describe("OnboardingView — seeded greeting bubble in the rendered tree", () => {
  it("renders the seeded greeting as the first assistant bubble for a fresh/empty transcript", () => {
    const state: OnboardingState = { ...initialOnboardingState, loading: false };
    const transcript = buildDisplayMessages([]);
    const view = OnboardingView({
      state,
      transcript,
      railSteps: computeRailSteps(state.stage, 1),
      scrollRef: { current: null },
      onInputChange: vi.fn(),
      onSend: vi.fn(),
      onRetry: vi.fn(),
      onFileChange: vi.fn(),
    });

    const [, , transcriptPane] = view.props.children;
    const [messageBubbles] = transcriptPane.props.children;
    const [greetingCard] = messageBubbles;

    expect(greetingCard.props.children.props.children).toBe(SEEDED_GREETING);
  });
});

describe("OnboardingView — progress rail active label per state", () => {
  it.each([
    { stage: "resume" as const, assistantMessageCount: 1, expected: "About you" },
    { stage: "resume" as const, assistantMessageCount: 3, expected: "Resume" },
    { stage: "identity" as const, assistantMessageCount: 5, expected: "Basics" },
    { stage: "done" as const, assistantMessageCount: 12, expected: "Done" },
  ])("stage=$stage, assistantMessageCount=$assistantMessageCount -> $expected is current", ({
    stage,
    assistantMessageCount,
    expected,
  }) => {
    const state: OnboardingState = { ...initialOnboardingState, loading: false, stage, done: stage === "done" };
    const view = OnboardingView({
      state,
      transcript: buildDisplayMessages(state.messages),
      railSteps: computeRailSteps(stage, assistantMessageCount),
      scrollRef: { current: null },
      onInputChange: vi.fn(),
      onSend: vi.fn(),
      onRetry: vi.fn(),
      onFileChange: vi.fn(),
    });

    const badges = railBadges(view);
    const active = badges.find((b: (typeof badges)[number]) => b.props.tone === "amber");
    expect(active.props.children).toBe(expected);
    expect(badges.filter((b: (typeof badges)[number]) => b.props.tone === "amber")).toHaveLength(1);
  });
});

describe("OnboardingView — failed turn: error banner + retry, composer draft preserved", () => {
  it("shows the error banner with a working Retry button, and keeps the typed draft in the composer", () => {
    const state: OnboardingState = {
      ...initialOnboardingState,
      loading: false,
      input: "here is my resume",
      turnError: "Something went wrong.",
    };
    const onRetry = vi.fn();
    const view = OnboardingView({
      state,
      transcript: buildDisplayMessages(state.messages),
      railSteps: computeRailSteps(state.stage, 1),
      scrollRef: { current: null },
      onInputChange: vi.fn(),
      onSend: vi.fn(),
      onRetry,
      onFileChange: vi.fn(),
    });

    const [, , , composer] = view.props.children;
    const [turnErrorBanner, , textArea] = composer.props.children;
    const errorRow = turnErrorBanner.props.children;
    const [errorSpan, retryButton] = errorRow.props.children;

    expect(errorSpan.props.children).toBe("Something went wrong.");
    expect(retryButton.props.children).toBe("Retry");

    retryButton.props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);

    // The composer must still show the preserved draft, not a cleared input.
    expect(textArea.props.value).toBe("here is my resume");
  });
});

describe("OnboardingView — rejected upload message in the rendered tree", () => {
  it("shows the upload-rejection message without touching the composer draft", () => {
    const state: OnboardingState = {
      ...initialOnboardingState,
      loading: false,
      uploadError: "Please upload a .txt or .md file.",
    };
    const view = OnboardingView({
      state,
      transcript: buildDisplayMessages(state.messages),
      railSteps: computeRailSteps(state.stage, 1),
      scrollRef: { current: null },
      onInputChange: vi.fn(),
      onSend: vi.fn(),
      onRetry: vi.fn(),
      onFileChange: vi.fn(),
    });

    const [, , , composer] = view.props.children;
    const [, uploadErrorNode, textArea] = composer.props.children;

    expect(uploadErrorNode.props.children).toBe("Please upload a .txt or .md file.");
    expect(textArea.props.value).toBe("");
  });
});
