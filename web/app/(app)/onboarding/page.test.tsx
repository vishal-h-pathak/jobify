import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/anthropic/interview";
import { RESUME_SKIP_MESSAGE } from "@/lib/onboarding/handleTurn";
import { AnchorForm } from "@/components/onboarding/AnchorForm";
import { CalibrationGeneratingSkeleton, CalibrationPanel } from "@/components/onboarding/CalibrationPanel";
import { deriveSpineSteps } from "@/components/onboarding/StepSpine";
import {
  ChatStageView,
  DoneView,
  OnboardingView,
  fetchInitialState,
  handleUpload,
  initialOnboardingState,
  onboardingReducer,
  submitAnchor,
  submitTurn,
  validateUploadName,
  type OnboardingState,
} from "./page";

/**
 * This repo's vitest config runs in the `node` environment with no
 * jsdom/@testing-library/react installed — every stateful/hook-bearing test
 * extracts business logic into plain, dependency-injected functions and a
 * pure reducer, then tests those directly (see lib/onboarding/handleTurn.test.ts).
 * Hook-free presentational views (`OnboardingView`, `ChatStageView`,
 * `DoneView`) are exercised by *directly invoking* them as plain functions
 * and inspecting the returned element tree, same as FileButton.test.tsx.
 */

function fakeResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

function noop() {
  /* unused callback slot in a test that doesn't exercise it */
}

const baseViewProps = {
  calibrationPrompts: [] as string[],
  scrollRef: { current: null },
  onInputChange: noop,
  onSend: noop,
  onRetry: noop,
  onFileChange: noop,
  onSkip: noop,
  onAnchorFieldChange: noop,
  onAnchorModeToggle: noop,
  onAnchorSubmit: noop,
  onCalibrationAnswerChange: noop,
  onCalibrationSubmit: noop,
};

describe("fetchInitialState — GET /api/onboarding/state", () => {
  it("defaults a brand-new session to the anchor stage", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ stage: undefined, messages: [], status: "in_progress" }));
    const result = await fetchInitialState(fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ messages: [], stage: "anchor", done: false });
  });

  it("restores a resumed session's stage and messages", async () => {
    const persisted: ChatMessage[] = [{ role: "assistant", content: "Show your range…" }];
    const fetchMock = vi.fn(async () => fakeResponse({ stage: "calibration", messages: persisted, status: "in_progress" }));
    const result = await fetchInitialState(fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ messages: persisted, stage: "calibration", done: false });
  });

  it("rejects when the request fails", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({}, false));
    await expect(fetchInitialState(fetchMock as unknown as typeof fetch)).rejects.toThrow("Could not load your session.");
  });
});

describe("submitTurn — POST /api/onboarding/turn", () => {
  it("rejects on a non-2xx response with the server's error", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ error: "model overloaded" }, false));
    await expect(submitTurn("hello", fetchMock as unknown as typeof fetch)).rejects.toThrow("model overloaded");
  });

  it("rejects when fetch itself throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(submitTurn("hello", fetchMock as unknown as typeof fetch)).rejects.toThrow("network down");
  });
});

describe("submitAnchor — POST /api/onboarding/anchor", () => {
  it("resolves with the new stage on success", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/api/onboarding/anchor");
      return fakeResponse({ stage: "calibration" });
    });
    const result = await submitAnchor({ current_title: "PM", current_company: "Foo" }, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ stage: "calibration" });
  });

  it("rejects with the server's error on a replay past the anchor stage (409)", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({ error: "onboarding has already moved past the anchor stage" }, false)
    );
    await expect(submitAnchor({ free_text: "x" }, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      "onboarding has already moved past the anchor stage"
    );
  });
});

describe("handleUpload / validateUploadName", () => {
  it("accepts a .txt file and returns its text", async () => {
    const file = new File(["resume body"], "resume.txt", { type: "text/plain" });
    expect(await handleUpload(file)).toEqual({ ok: true, text: "resume body" });
  });

  it("rejects a disallowed extension without reading it", async () => {
    const file = new File(["binary"], "resume.pdf", { type: "application/pdf" });
    const textSpy = vi.spyOn(file, "text");
    expect(await handleUpload(file)).toEqual({ ok: false, error: "Please upload a .txt or .md file." });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("accepts .md", () => {
    expect(validateUploadName("resume.md")).toBeNull();
  });
});

describe("onboardingReducer — anchor stage transitions", () => {
  it("anchor_field_changed updates one field and clears anchorError", () => {
    const withError = { ...initialOnboardingState, anchorError: "provide current_title + current_company, or free_text" };
    const next = onboardingReducer(withError, { type: "anchor_field_changed", field: "currentTitle", value: "PM" });
    expect(next.anchorValues.currentTitle).toBe("PM");
    expect(next.anchorValues.currentCompany).toBe("");
    expect(next.anchorError).toBe("");
  });

  it("anchor_mode_toggled flips role <-> situation", () => {
    const situation = onboardingReducer(initialOnboardingState, { type: "anchor_mode_toggled" });
    expect(situation.anchorValues.mode).toBe("situation");
    const backToRole = onboardingReducer(situation, { type: "anchor_mode_toggled" });
    expect(backToRole.anchorValues.mode).toBe("role");
  });

  it("anchor_submit_started sets anchorSubmitting and clears any prior error", () => {
    const withError = { ...initialOnboardingState, anchorError: "oops" };
    const next = onboardingReducer(withError, { type: "anchor_submit_started" });
    expect(next.anchorSubmitting).toBe(true);
    expect(next.anchorError).toBe("");
  });

  it("anchor_submit_succeeded advances to calibration, flags generation in flight, and records the Role receipt", () => {
    const started = onboardingReducer(initialOnboardingState, { type: "anchor_submit_started" });
    const next = onboardingReducer(started, { type: "anchor_submit_succeeded", receipt: "PM · Foo" });
    expect(next.stage).toBe("calibration");
    expect(next.calibrationGenerating).toBe(true);
    expect(next.anchorSubmitting).toBe(false);
    expect(next.receipts.anchor).toBe("PM · Foo");
  });

  it("anchor_submit_failed preserves the typed form values (draft preserved on failure)", () => {
    const typed = onboardingReducer(initialOnboardingState, {
      type: "anchor_field_changed",
      field: "currentTitle",
      value: "PM",
    });
    const started = onboardingReducer(typed, { type: "anchor_submit_started" });
    const failed = onboardingReducer(started, { type: "anchor_submit_failed", error: "Something went wrong." });
    expect(failed.anchorValues.currentTitle).toBe("PM");
    expect(failed.anchorSubmitting).toBe(false);
    expect(failed.anchorError).toBe("Something went wrong.");
  });

  it("state_loaded (the follow-up fetch after anchor submit) clears calibrationGenerating", () => {
    const generating = { ...initialOnboardingState, calibrationGenerating: true, stage: "calibration" as const };
    const loaded = onboardingReducer(generating, {
      type: "state_loaded",
      messages: [{ role: "assistant", content: "Four short prompts…" }],
      stage: "calibration",
      done: false,
    });
    expect(loaded.calibrationGenerating).toBe(false);
    expect(loaded.loading).toBe(false);
  });
});

describe("onboardingReducer — calibration stage transitions", () => {
  it("calibration_answer_changed updates only the targeted index", () => {
    const first = onboardingReducer(initialOnboardingState, { type: "calibration_answer_changed", index: 2, value: "range answer" });
    expect(first.calibrationAnswers).toEqual(["", "", "range answer", ""]);
  });

  it("turn_succeeded with a calibration receiptUpdate merges it into receipts and advances stage", () => {
    const started = onboardingReducer(initialOnboardingState, { type: "turn_started" });
    const succeeded = onboardingReducer(started, {
      type: "turn_succeeded",
      userMessage: "1. a\n\n2. b\n\n3. c\n\n4. d",
      assistantText: "Have a resume handy?",
      stage: "resume",
      done: false,
      receiptUpdate: { calibration: "4 answers" },
    });
    expect(succeeded.stage).toBe("resume");
    expect(succeeded.receipts).toEqual({ calibration: "4 answers" });
  });

  it("turn_failed after a calibration submit preserves the four answers (draft preserved on failed turn)", () => {
    const withAnswers: OnboardingState = {
      ...initialOnboardingState,
      calibrationAnswers: ["a", "b", "c", "d"],
    };
    const started = onboardingReducer(withAnswers, { type: "turn_started" });
    const failed = onboardingReducer(started, { type: "turn_failed", error: "model overloaded" });
    expect(failed.calibrationAnswers).toEqual(["a", "b", "c", "d"]);
    expect(failed.turnError).toBe("model overloaded");
    expect(failed.sending).toBe(false);
  });
});

describe("onboardingReducer — resume stage receipts (skip vs provided)", () => {
  it("a normal send in the resume stage records 'resume added'", () => {
    const state: OnboardingState = { ...initialOnboardingState, stage: "resume", input: "here is my resume" };
    const started = onboardingReducer(state, { type: "turn_started" });
    const succeeded = onboardingReducer(started, {
      type: "turn_succeeded",
      userMessage: "here is my resume",
      assistantText: "Logistics, all in one go: …",
      stage: "targeting",
      done: false,
      receiptUpdate: { resume: "resume added" },
    });
    expect(succeeded.receipts.resume).toBe("resume added");
  });

  it("the skip path records the skipped receipt with its own display text", () => {
    const state: OnboardingState = { ...initialOnboardingState, stage: "resume" };
    const started = onboardingReducer(state, { type: "turn_started" });
    const succeeded = onboardingReducer(started, {
      type: "turn_succeeded",
      userMessage: "Skipped — using the anchor and range answers instead.",
      assistantText: "Logistics, all in one go: …",
      stage: "targeting",
      done: false,
      receiptUpdate: { resume: "skipped — built from your answers" },
    });
    expect(succeeded.messages[0]).toEqual({
      role: "user",
      content: "Skipped — using the anchor and range answers instead.",
    });
    expect(succeeded.receipts.resume).toBe("skipped — built from your answers");
  });
});

describe("onboardingReducer — turn_failed keeps the composer draft (regression, carried from v1)", () => {
  it("preserves state.input across a failed send", () => {
    const typed = onboardingReducer(initialOnboardingState, { type: "input_changed", value: "here is my resume" });
    const started = onboardingReducer(typed, { type: "turn_started" });
    const failed = onboardingReducer(started, { type: "turn_failed", error: "Something went wrong." });
    expect(failed.input).toBe("here is my resume");
    expect(failed.sending).toBe(false);
  });

  it("upload_rejected surfaces the message without touching the composer draft", () => {
    const next = onboardingReducer(initialOnboardingState, { type: "upload_rejected", error: "Please upload a .txt or .md file." });
    expect(next.uploadError).toBe("Please upload a .txt or .md file.");
    expect(next.input).toBe("");
  });

  it("upload_accepted populates the composer and clears any prior upload error", () => {
    const rejected = onboardingReducer(initialOnboardingState, { type: "upload_rejected", error: "bad file" });
    const accepted = onboardingReducer(rejected, { type: "upload_accepted", fileName: "resume.txt", text: "body" });
    expect(accepted.uploadError).toBeNull();
    expect(accepted.input).toBe("body");
    expect(accepted.fileName).toBe("resume.txt");
  });
});

describe("OnboardingView — loading and error states", () => {
  it("renders a spine+panel skeleton, not a centered spinner, while loading", () => {
    const view = OnboardingView({ state: { ...initialOnboardingState, loading: true }, ...baseViewProps });
    expect(view.props.children).toHaveLength(3);
    expect(view.props.children.every((c: { props: { className: string } }) => c.props.className.includes("animate-pulse"))).toBe(
      true
    );
  });

  it("renders the load-error banner", () => {
    const view = OnboardingView({
      state: { ...initialOnboardingState, loading: false, loadError: "Could not load your session." },
      ...baseViewProps,
    });
    const banner = view.props.children;
    expect(banner.props.children).toBe("Could not load your session.");
  });
});

describe("OnboardingView — stage panel swap", () => {
  function panelOf(state: OnboardingState, calibrationPrompts: string[] = []) {
    const view = OnboardingView({ state, ...baseViewProps, calibrationPrompts });
    const [, contentDiv] = view.props.children;
    const [, panelWrapper] = contentDiv.props.children;
    return panelWrapper.props.children;
  }

  it("anchor stage renders AnchorForm plus the beta disclosure line (ONB-D handoff)", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, stage: "anchor" });
    // The anchor panel is a fragment: [AnchorForm, disclosure <p>].
    const [form, disclosure] = panel.props.children;
    expect(form.type).toBe(AnchorForm);
    expect(disclosure.type).toBe("p");
    expect(typeof disclosure.props.children).toBe("string");
    expect(disclosure.props.children.length).toBeGreaterThan(10);
  });

  it("calibration stage while generating renders the loading skeleton, not CalibrationPanel", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, stage: "calibration", calibrationGenerating: true });
    expect(panel.type).toBe(CalibrationGeneratingSkeleton);
  });

  it("calibration stage once generated renders CalibrationPanel with the parsed prompts", () => {
    const panel = panelOf(
      { ...initialOnboardingState, loading: false, stage: "calibration", calibrationGenerating: false },
      ["depth", "breadth", "range", "evidence"]
    );
    expect(panel.type).toBe(CalibrationPanel);
    expect(panel.props.prompts).toEqual(["depth", "breadth", "range", "evidence"]);
  });

  it("resume stage renders ChatStageView with upload + skip reachable", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, stage: "resume" });
    expect(panel.type).toBe(ChatStageView);
    const rendered = ChatStageView(panel.props);
    const composerChildren = rendered.props.children[rendered.props.children.length - 1].props.children;
    const uploadSkipSlot = composerChildren[0];
    expect(uploadSkipSlot.props.children).toBeTruthy();
  });

  it("targeting stage renders ChatStageView with upload + skip NOT reachable", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, stage: "targeting" });
    expect(panel.type).toBe(ChatStageView);
    const rendered = ChatStageView(panel.props);
    const composerChildren = rendered.props.children[rendered.props.children.length - 1].props.children;
    const uploadSkipSlot = composerChildren[0];
    // A plain empty <div /> placeholder, not the FileButton+Skip cluster.
    expect(uploadSkipSlot.props.children).toBeUndefined();
  });

  it("done stage renders DoneView", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, stage: "done", done: true });
    expect(panel.type).toBe(DoneView);
  });

  it("wires the spine from deriveSpineSteps(stage, receipts)", () => {
    const state: OnboardingState = {
      ...initialOnboardingState,
      loading: false,
      stage: "resume",
      receipts: { anchor: "PM · Foo", calibration: "4 answers" },
    };
    const view = OnboardingView({ state, ...baseViewProps });
    const [, contentDiv] = view.props.children;
    const [spine] = contentDiv.props.children;
    expect(spine.props.steps).toEqual(deriveSpineSteps("resume", state.receipts));
  });
});

describe("ChatStageView — motion classes wired to ONB-C's utilities", () => {
  it("each message carries the message-enter class; the panel wrapper carries panel-enter", () => {
    const state: OnboardingState = {
      ...initialOnboardingState,
      loading: false,
      stage: "targeting",
      messages: [{ role: "assistant", content: "Logistics, all in one go: …" }],
    };
    const rendered = ChatStageView({
      state,
      scrollRef: { current: null },
      onInputChange: noop,
      onSend: noop,
      onRetry: noop,
      onFileChange: noop,
      onSkip: noop,
    });
    const [messageList] = rendered.props.children;
    const [messageElements] = messageList.props.children;
    const [assistantBubble] = messageElements;
    expect(assistantBubble.props.className).toContain("message-enter");

    const view = OnboardingView({ state, ...baseViewProps });
    const [, contentDiv] = view.props.children;
    const [, panelWrapper] = contentDiv.props.children;
    expect(panelWrapper.props.className).toContain("panel-enter");
  });
});

describe("ChatStageView — active question is visually the protagonist (text-lg), history is muted", () => {
  it("only the last assistant message gets text-lg; earlier ones stay text-sm", () => {
    const state: OnboardingState = {
      ...initialOnboardingState,
      loading: false,
      stage: "targeting",
      messages: [
        { role: "assistant", content: "Have a resume handy?" },
        { role: "user", content: "Skipped — using the anchor and range answers instead." },
        { role: "assistant", content: "Logistics, all in one go: …" },
      ],
    };
    const rendered = ChatStageView({
      state,
      scrollRef: { current: null },
      onInputChange: noop,
      onSend: noop,
      onRetry: noop,
      onFileChange: noop,
      onSkip: noop,
    });
    const [messageList] = rendered.props.children;
    const [messageElements] = messageList.props.children;
    const [firstAssistant, , secondAssistant] = messageElements;
    expect(firstAssistant.props.className).toContain("text-sm");
    expect(secondAssistant.props.className).toContain("text-lg");
  });
});

describe("ChatStageView — placeholder copy is stage-driven", () => {
  it("differs between resume and targeting", () => {
    const resumeView = ChatStageView({
      state: { ...initialOnboardingState, loading: false, stage: "resume" },
      scrollRef: { current: null },
      onInputChange: noop,
      onSend: noop,
      onRetry: noop,
      onFileChange: noop,
      onSkip: noop,
    });
    const targetingView = ChatStageView({
      state: { ...initialOnboardingState, loading: false, stage: "targeting" },
      scrollRef: { current: null },
      onInputChange: noop,
      onSend: noop,
      onRetry: noop,
      onFileChange: noop,
      onSkip: noop,
    });
    const composerChildren = (v: ReturnType<typeof ChatStageView>) => v.props.children;
    const resumeTextArea = composerChildren(resumeView)[3];
    const targetingTextArea = composerChildren(targetingView)[3];
    expect(resumeTextArea.props.placeholder).not.toBe(targetingTextArea.props.placeholder);
  });
});

describe("ChatStageView — failed turn: error banner + retry, draft preserved (ported from v1)", () => {
  it("shows the error banner with a working Retry button, and keeps the typed draft in the composer", () => {
    const onRetry = vi.fn();
    const state: OnboardingState = {
      ...initialOnboardingState,
      loading: false,
      stage: "targeting",
      input: "my answer",
      turnError: "Something went wrong.",
    };
    const rendered = ChatStageView({
      state,
      scrollRef: { current: null },
      onInputChange: noop,
      onSend: noop,
      onRetry,
      onFileChange: noop,
      onSkip: noop,
    });
    const [, turnErrorBanner, , textArea] = rendered.props.children;
    const errorRow = turnErrorBanner.props.children;
    const [errorSpan, retryButton] = errorRow.props.children;
    expect(errorSpan.props.children).toBe("Something went wrong.");
    retryButton.props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(textArea.props.value).toBe("my answer");
  });
});

describe("ChatStageView — Skip button sends the reserved sentinel via onSkip", () => {
  it("wires the Skip button, present only in the resume stage", () => {
    const onSkip = vi.fn();
    const rendered = ChatStageView({
      state: { ...initialOnboardingState, loading: false, stage: "resume" },
      scrollRef: { current: null },
      onInputChange: noop,
      onSend: noop,
      onRetry: noop,
      onFileChange: noop,
      onSkip,
    });
    const composerChildren = rendered.props.children[rendered.props.children.length - 1].props.children;
    const [, skipButton] = composerChildren[0].props.children;
    skipButton.props.onClick();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe("DoneView — the summary moment", () => {
  it("renders the three recap sections (rank-up / never-show / logistics) as separate paragraphs", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "confirmed" },
      {
        role: "assistant",
        content: [
          "Here's what I built: you'll rank up senior backend roles at seed-to-series-B startups.",
          "You'll never see anything requiring a security clearance or on-call-heavy SRE work.",
          "Logistics: Atlanta-based, remote-first, $180k floor.",
          'Head to your feed and hit "Run my hunt" to get your first results.',
        ].join("\n\n"),
      },
    ];
    const view = DoneView({ messages });
    const [, , recapSection] = view.props.children;
    const paragraphs = recapSection.props.children;
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[0].props.children).toContain("rank up");
    expect(paragraphs[1].props.children).toContain("never see");
    expect(paragraphs[2].props.children).toContain("Logistics");
  });

  it("shows the fix-needed heading and error list when validation is invalid", () => {
    const view = DoneView({
      messages: [{ role: "assistant", content: "Summary." }],
      validation: { status: "invalid", errors: ["tiers must be non-empty"] },
    });
    const [heading, errorList] = view.props.children;
    expect(heading.props.children).toBe("Profile saved, but needs a fix:");
    expect(errorList.props.children[0].props.children).toBe("tiers must be non-empty");
  });

  it("links to /feed with the primary 'Run my first hunt' action", () => {
    const view = DoneView({ messages: [{ role: "assistant", content: "Summary." }] });
    const [, , , link] = view.props.children;
    expect(link.props.href).toBe("/feed");
    expect(link.props.children).toBe("Run my first hunt");
  });
});

describe("RESUME_SKIP_MESSAGE — page consumes ONB-A's exported sentinel, doesn't redefine it", () => {
  it("is the string handleTurn.ts special-cases", () => {
    expect(RESUME_SKIP_MESSAGE).toBe("__skip_resume__");
  });
});
