import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/anthropic/interview";
import type { ModulesState } from "@/lib/onboarding/moduleRegistry";
import { RESUME_SKIP_MESSAGE } from "@/lib/onboarding/handleTurn";
import { AnchorForm } from "@/components/onboarding/AnchorForm";
import { CalibrationGeneratingSkeleton } from "@/components/onboarding/CalibrationPanel";
import { PhaseRail } from "@/components/onboarding/PhaseRail";
import { ReactionDeck } from "@/components/onboarding/ReactionDeck";
import { ValuePairsPanel } from "@/components/onboarding/ValuePairsPanel";
import { DealbreakersPanel } from "@/components/onboarding/DealbreakersPanel";
import { EnergyPanel } from "@/components/onboarding/EnergyPanel";
import { EnvironmentPanel } from "@/components/onboarding/EnvironmentPanel";
import { TrajectoryPanel } from "@/components/onboarding/TrajectoryPanel";
import { CheckpointInterstitial } from "@/components/onboarding/CheckpointInterstitial";
import { VoicePanel } from "@/components/onboarding/VoicePanel";
import { MetricsPanel } from "@/components/onboarding/MetricsPanel";
import { MirrorPanel } from "@/components/onboarding/MirrorPanel";
import {
  ChatStageView,
  DoneForNowView,
  OnboardingView,
  deriveHuntStatusLabel,
  fetchInitialState,
  handleUpload,
  initialOnboardingState,
  navigateToProfile,
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
 * Hook-free presentational views (`OnboardingView`, `ChatStageView`) are
 * exercised by *directly invoking* them as plain functions and inspecting
 * the returned element tree, same as FileButton.test.tsx.
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
  onModuleComplete: noop,
  onMirrorComplete: noop,
  onCheckpointContinue: noop,
};

function completion(receipt: string, completedAt = "2026-07-16T00:00:00.000Z") {
  return { completed_at: completedAt, receipt };
}

const PHASE_ONE_DONE: ModulesState = {
  anchor: completion("Engineer · Acme"),
  reactions: completion("6 reactions (4 interested)"),
  values: completion("7 trade-offs answered"),
  dealbreakers: completion("2 dealbreakers"),
};

const PHASE_TWO_STRUCTURED_DONE: ModulesState = {
  ...PHASE_ONE_DONE,
  energy: completion("2 energy signals"),
  environment: completion("4 scenarios chosen"),
  trajectory: completion("trajectory: climb"),
};

// range/evidence derive complete from `stage: "done"` alone (moduleOrder.ts),
// so `stage: "done"` + PHASE_TWO_STRUCTURED_DONE is enough to make "voice"
// the next canonical module without an explicit modules.range/evidence entry.
const PHASE_THREE_VOICE_DONE: ModulesState = { ...PHASE_TWO_STRUCTURED_DONE, voice: completion("voice: dry, compressed") };
const PHASE_THREE_METRICS_DONE: ModulesState = {
  ...PHASE_THREE_VOICE_DONE,
  metrics: completion("2 confirmed · 1 held back"),
};
const ALL_MODULES_DONE: ModulesState = { ...PHASE_THREE_METRICS_DONE, mirror: completion("mirror accepted") };

describe("fetchInitialState — GET /api/onboarding/state", () => {
  it("defaults a brand-new session and extends with modules/matchCount/valuePairs/environmentScenarios", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        stage: undefined,
        messages: [],
        status: "in_progress",
        modules: {},
        match_count: 0,
        value_pairs: [{ pair_id: "mission_prestige", a: "Mission", b: "Prestige" }],
        environment_scenarios: [{ key: "team_size", a: "Small", b: "Large" }],
      })
    );
    const result = await fetchInitialState(fetchMock as unknown as typeof fetch);
    expect(result).toEqual({
      messages: [],
      stage: "anchor",
      done: false,
      modules: {},
      matchCount: 0,
      valuePairs: [{ pair_id: "mission_prestige", a: "Mission", b: "Prestige" }],
      environmentScenarios: [{ key: "team_size", a: "Small", b: "Large" }],
    });
  });

  it("restores a resumed session's stage, messages, and modules", async () => {
    const persisted: ChatMessage[] = [{ role: "assistant", content: "Show your range…" }];
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        stage: "calibration",
        messages: persisted,
        status: "in_progress",
        modules: PHASE_ONE_DONE,
        match_count: 3,
        value_pairs: [],
        environment_scenarios: [],
      })
    );
    const result = await fetchInitialState(fetchMock as unknown as typeof fetch);
    expect(result.stage).toBe("calibration");
    expect(result.modules).toEqual(PHASE_ONE_DONE);
    expect(result.matchCount).toBe(3);
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
    const file = new File(["binary"], "resume.docx", { type: "application/octet-stream" });
    const textSpy = vi.spyOn(file, "text");
    expect(await handleUpload(file)).toEqual({ ok: false, error: "Please upload a .pdf, .txt, or .md file." });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("accepts .md", () => {
    expect(validateUploadName("resume.md")).toBeNull();
  });

  it("accepts .pdf by name (extension check only — the route call itself is exercised below)", () => {
    expect(validateUploadName("resume.pdf")).toBeNull();
  });
});

describe("handleUpload — .pdf routes through /api/resume/extract (judgment call #8)", () => {
  it("POSTs the file as multipart FormData under the 'file' field and returns the extracted text", async () => {
    const file = new File(["%PDF-1.4 fake bytes"], "resume.pdf", { type: "application/pdf" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/resume/extract");
      expect(init?.method).toBe("POST");
      const body = init?.body as FormData;
      expect(body.get("file")).toBe(file);
      return fakeResponse({ ok: true, text: "extracted resume text" });
    });
    const result = await handleUpload(file, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, text: "extracted resume text" });
  });

  it("maps a 422 { ok: false, error } response to the same UploadResult shape as a client-side rejection", async () => {
    const file = new File(["not really a pdf"], "resume.pdf", { type: "application/pdf" });
    const fetchMock = vi.fn(async () =>
      fakeResponse({ ok: false, error: "Couldn't read text in this PDF — paste it instead." }, false)
    );
    const result = await handleUpload(file, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, error: "Couldn't read text in this PDF — paste it instead." });
  });

  it("does not call the extract route for .txt/.md — those stay client-side unchanged", async () => {
    const fetchMock = vi.fn();
    const file = new File(["plain resume"], "resume.txt", { type: "text/plain" });
    const result = await handleUpload(file, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, text: "plain resume" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleUpload -> upload_accepted -> state.input — spy test proving extracted PDF text reaches the exact same field pasted/.txt text does (the field submitTurn reads)", () => {
  it("a .pdf upload's extracted text ends up in state.input via the same 'upload_accepted' action a .txt upload would dispatch", async () => {
    const pdfFile = new File(["%PDF-1.4 fake bytes"], "resume.pdf", { type: "application/pdf" });
    const fetchMock = vi.fn(async () => fakeResponse({ ok: true, text: "PDF-extracted resume body" }));

    const result = await handleUpload(pdfFile, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    // This mirrors exactly what handleFile (page.tsx) does with handleUpload's
    // result for every extension, including .txt — proving the .pdf path
    // feeds the identical reducer action, and therefore the identical
    // `state.input` field that `handleSend`/`submitTurn` read, as a pasted
    // or .txt-uploaded resume would.
    const next = onboardingReducer(initialOnboardingState, {
      type: "upload_accepted",
      fileName: pdfFile.name,
      text: result.text,
    });
    expect(next.input).toBe("PDF-extracted resume body");
    expect(next.fileName).toBe("resume.pdf");
    expect(next.uploadError).toBeNull();
  });
});

describe("deriveHuntStatusLabel", () => {
  it("null before the checkpoint has fired", () => {
    expect(deriveHuntStatusLabel({}, 0)).toBeNull();
  });

  it("hunt #1 running · HH:MM before any matches exist", () => {
    const modules: ModulesState = { checkpoint_hunt: { fired_at: "2026-07-16T14:32:00.000Z" } };
    expect(deriveHuntStatusLabel(modules, 0)).toMatch(/^hunt #1 running · \d{2}:\d{2}$/);
  });

  it("swaps to 'N matches waiting' once matches exist", () => {
    const modules: ModulesState = { checkpoint_hunt: { fired_at: "2026-07-16T14:32:00.000Z" } };
    expect(deriveHuntStatusLabel(modules, 4)).toBe("4 matches waiting");
  });

  it("singular 'match' for exactly 1", () => {
    const modules: ModulesState = { checkpoint_hunt: { fired_at: "2026-07-16T14:32:00.000Z" } };
    expect(deriveHuntStatusLabel(modules, 1)).toBe("1 match waiting");
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

  it("state_loaded (the follow-up fetch after anchor submit) clears calibrationGenerating and carries modules/matchCount", () => {
    const generating = { ...initialOnboardingState, calibrationGenerating: true, stage: "calibration" as const };
    const loaded = onboardingReducer(generating, {
      type: "state_loaded",
      messages: [{ role: "assistant", content: "Four short prompts…" }],
      stage: "calibration",
      done: false,
      modules: { anchor: completion("PM · Foo") },
      matchCount: 0,
      valuePairs: [],
      environmentScenarios: [],
    });
    expect(loaded.calibrationGenerating).toBe(false);
    expect(loaded.loading).toBe(false);
    expect(loaded.modules).toEqual({ anchor: completion("PM · Foo") });
  });
});

describe("onboardingReducer — checkpoint interstitial + redo", () => {
  it("checkpoint_interstitial_shown / dismissed toggle interstitialPending", () => {
    const shown = onboardingReducer(initialOnboardingState, { type: "checkpoint_interstitial_shown" });
    expect(shown.interstitialPending).toBe(true);
    const dismissed = onboardingReducer(shown, { type: "checkpoint_interstitial_dismissed" });
    expect(dismissed.interstitialPending).toBe(false);
  });

  it("redo_requested / redo_cleared set and clear redoModule", () => {
    const requested = onboardingReducer(initialOnboardingState, { type: "redo_requested", key: "values" });
    expect(requested.redoModule).toBe("values");
    const cleared = onboardingReducer(requested, { type: "redo_cleared" });
    expect(cleared.redoModule).toBeNull();
  });
});

describe("onboardingReducer — calibration stage transitions", () => {
  it("calibration_answer_changed updates only the targeted index", () => {
    const first = onboardingReducer(initialOnboardingState, { type: "calibration_answer_changed", index: 2, value: "range answer" });
    expect(first.calibrationAnswers).toEqual(["", "", "range answer", ""]);
  });

  it("turn_succeeded advances stage and appends messages", () => {
    const started = onboardingReducer(initialOnboardingState, { type: "turn_started" });
    const succeeded = onboardingReducer(started, {
      type: "turn_succeeded",
      userMessage: "1. a\n\n2. b\n\n3. c\n\n4. d",
      assistantText: "Have a resume handy?",
      stage: "resume",
      done: false,
    });
    expect(succeeded.stage).toBe("resume");
    expect(succeeded.messages).toHaveLength(2);
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
  it("renders a rail+panel skeleton, not a centered spinner, while loading", () => {
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

describe("OnboardingView — PhaseRail + hunt status chip wiring", () => {
  function header(state: OnboardingState) {
    const view = OnboardingView({ state, ...baseViewProps });
    const [, contentDiv] = view.props.children;
    const [headerRow] = contentDiv.props.children;
    return headerRow;
  }

  it("passes modules/stage/sweeping through to PhaseRail", () => {
    const state: OnboardingState = { ...initialOnboardingState, loading: false, modules: PHASE_ONE_DONE, stage: "calibration" };
    const [railWrapper] = header(state).props.children;
    const rail = railWrapper.props.children;
    expect(rail.type).toBe(PhaseRail);
    expect(rail.props.modules).toEqual(PHASE_ONE_DONE);
    expect(rail.props.stage).toBe("calibration");
    expect(rail.props.sweeping).toBe(false);
  });

  it("sweeping mirrors interstitialPending", () => {
    const state: OnboardingState = { ...initialOnboardingState, loading: false, interstitialPending: true, modules: PHASE_ONE_DONE };
    const [railWrapper] = header(state).props.children;
    expect(railWrapper.props.children.props.sweeping).toBe(true);
  });

  it("no status chip before the checkpoint fires", () => {
    const state: OnboardingState = { ...initialOnboardingState, loading: false };
    const [, chip] = header(state).props.children;
    expect(chip).toBeFalsy();
  });

  it("shows the status chip once checkpoint_hunt exists", () => {
    const modules: ModulesState = { ...PHASE_ONE_DONE, checkpoint_hunt: { fired_at: "2026-07-16T14:32:00.000Z" } };
    const state: OnboardingState = { ...initialOnboardingState, loading: false, modules, matchCount: 2 };
    const [, chip] = header(state).props.children;
    expect(chip.props.children).toBe("2 matches waiting");
  });
});

describe("OnboardingView — checkpoint interstitial takes over the panel slot", () => {
  it("renders CheckpointInterstitial, honestly branched, while interstitialPending", () => {
    const modules: ModulesState = { ...PHASE_ONE_DONE, checkpoint_hunt: { fired_at: "2026-07-16T14:32:00.000Z" } };
    const state: OnboardingState = { ...initialOnboardingState, loading: false, interstitialPending: true, modules, matchCount: 5 };
    const view = OnboardingView({ state, ...baseViewProps });
    const [, contentDiv] = view.props.children;
    const [, panelWrapper] = contentDiv.props.children;
    const interstitial = panelWrapper.props.children;
    expect(interstitial.type).toBe(CheckpointInterstitial);
    expect(interstitial.props.fired).toBe(true);
    expect(interstitial.props.matchCount).toBe(5);
  });

  it("branches honestly to fired=false when checkpoint_hunt never landed", () => {
    const state: OnboardingState = { ...initialOnboardingState, loading: false, interstitialPending: true, modules: PHASE_ONE_DONE };
    const view = OnboardingView({ state, ...baseViewProps });
    const [, contentDiv] = view.props.children;
    const [, panelWrapper] = contentDiv.props.children;
    expect(panelWrapper.props.children.props.fired).toBe(false);
  });

  it("the continue button dismisses the interstitial via onCheckpointContinue", () => {
    const onCheckpointContinue = vi.fn();
    const state: OnboardingState = { ...initialOnboardingState, loading: false, interstitialPending: true, modules: PHASE_ONE_DONE };
    const view = OnboardingView({ state, ...baseViewProps, onCheckpointContinue });
    const [, contentDiv] = view.props.children;
    const [, panelWrapper] = contentDiv.props.children;
    panelWrapper.props.children.props.onContinue();
    expect(onCheckpointContinue).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardingView — module panel routing (V3A_DESIGN.md §1.2 canonical order)", () => {
  function panelOf(state: OnboardingState, calibrationPrompts: string[] = [], extraProps: Record<string, unknown> = {}) {
    const view = OnboardingView({ state, ...baseViewProps, ...extraProps, calibrationPrompts });
    const [, contentDiv] = view.props.children;
    const [, panelWrapper] = contentDiv.props.children;
    return panelWrapper.props.children;
  }

  it("a brand-new session (empty modules) renders AnchorForm plus the beta disclosure line", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: {}, stage: "anchor" });
    const [form, disclosure] = panel.props.children;
    expect(form.type).toBe(AnchorForm);
    expect(disclosure.type).toBe("p");
  });

  it("anchor done -> reactions: ReactionDeck with the intro copy above it", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: { anchor: completion("a") }, stage: "calibration" });
    const [, deck] = panel.props.children;
    expect(deck.type).toBe(ReactionDeck);
  });

  it("phase 1 done -> energy: EnergyPanel (dealbreakers just completed, not yet checkpointed in this test)", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: PHASE_ONE_DONE, stage: "calibration" });
    expect(panel.type).toBe(EnergyPanel);
  });

  it("energy done -> environment: EnvironmentPanel gets the scenarios prop", () => {
    const scenarios = [{ key: "team_size" as const, a: "Small", b: "Large" }];
    const panel = panelOf(
      {
        ...initialOnboardingState,
        loading: false,
        modules: { ...PHASE_ONE_DONE, energy: completion("e") },
        environmentScenarios: scenarios,
        stage: "calibration",
      },
      []
    );
    expect(panel.type).toBe(EnvironmentPanel);
    expect(panel.props.scenarios).toEqual(scenarios);
  });

  it("values module gets the valuePairs prop from state", () => {
    const valuePairs = [{ pair_id: "mission_prestige", a: "Mission", b: "Prestige" }];
    const panel = panelOf({
      ...initialOnboardingState,
      loading: false,
      modules: { anchor: completion("a"), reactions: completion("r") },
      valuePairs,
      stage: "calibration",
    });
    expect(panel.type).toBe(ValuePairsPanel);
    expect(panel.props.valuePairs).toEqual(valuePairs);
  });

  it("dealbreakers is the last phase-1 module", () => {
    const panel = panelOf({
      ...initialOnboardingState,
      loading: false,
      modules: { anchor: completion("a"), reactions: completion("r"), values: completion("v") },
      stage: "calibration",
    });
    expect(panel.type).toBe(DealbreakersPanel);
  });

  it("trajectory is the last of the phase-2 structured modules", () => {
    const panel = panelOf({
      ...initialOnboardingState,
      loading: false,
      modules: { ...PHASE_ONE_DONE, energy: completion("e"), environment: completion("en") },
      stage: "calibration",
    });
    expect(panel.type).toBe(TrajectoryPanel);
  });

  it("phase-2 structured modules done, chat stage still 'calibration' -> the interview block's calibration panel, not skipped past", () => {
    const panel = panelOf({
      ...initialOnboardingState,
      loading: false,
      modules: PHASE_TWO_STRUCTURED_DONE,
      stage: "calibration",
      calibrationGenerating: true,
    });
    expect(panel.type).toBe(CalibrationGeneratingSkeleton);
  });

  it("mid-targeting: even though evidence derives complete at stage>=targeting, the chat stays active (not Done-for-now) until stage is literally 'done'", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: PHASE_TWO_STRUCTURED_DONE, stage: "targeting" });
    expect(panel.type).toBe(ChatStageView);
  });

  it("resume sub-stage renders ChatStageView with upload+skip reachable", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: PHASE_TWO_STRUCTURED_DONE, stage: "resume" });
    expect(panel.type).toBe(ChatStageView);
    const rendered = ChatStageView(panel.props);
    const composerChildren = rendered.props.children[rendered.props.children.length - 1].props.children;
    expect(composerChildren[0].props.children).toBeTruthy();
  });

  it("interview block finished (stage 'done') -> VoicePanel, the first of B2's LLM modules", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: PHASE_TWO_STRUCTURED_DONE, stage: "done" });
    expect(panel.type).toBe(VoicePanel);
  });

  it("voice done -> MetricsPanel", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: PHASE_THREE_VOICE_DONE, stage: "done" });
    expect(panel.type).toBe(MetricsPanel);
  });

  it("metrics done -> MirrorPanel, the last canonical module", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: PHASE_THREE_METRICS_DONE, stage: "done" });
    expect(panel.type).toBe(MirrorPanel);
  });

  it("every canonical module complete (a stray post-completion revisit) -> Done-for-now", () => {
    const panel = panelOf({ ...initialOnboardingState, loading: false, modules: ALL_MODULES_DONE, stage: "done" });
    expect(panel.type).toBe(DoneForNowView);
  });

  it("redoModule overrides the guided next_module entirely", () => {
    const panel = panelOf({
      ...initialOnboardingState,
      loading: false,
      modules: PHASE_TWO_STRUCTURED_DONE, // guided next would be the interview block
      stage: "done",
      redoModule: "values",
      valuePairs: [],
    });
    expect(panel.type).toBe(ValuePairsPanel);
  });

  it("module onComplete callbacks are wired with the correct module key", () => {
    const onModuleComplete = vi.fn();
    const panel = panelOf(
      { ...initialOnboardingState, loading: false, modules: { ...PHASE_ONE_DONE }, stage: "calibration" },
      [],
      { onModuleComplete }
    );
    expect(panel.type).toBe(EnergyPanel);
    panel.props.onComplete();
    expect(onModuleComplete).toHaveBeenCalledWith("energy");
  });

  it("voice/metrics onComplete callbacks are wired through onModuleComplete like every other structured module", () => {
    const onModuleComplete = vi.fn();
    const voicePanel = panelOf(
      { ...initialOnboardingState, loading: false, modules: PHASE_TWO_STRUCTURED_DONE, stage: "done" },
      [],
      { onModuleComplete }
    );
    voicePanel.props.onComplete();
    expect(onModuleComplete).toHaveBeenCalledWith("voice");

    const metricsPanel = panelOf(
      { ...initialOnboardingState, loading: false, modules: PHASE_THREE_VOICE_DONE, stage: "done" },
      [],
      { onModuleComplete }
    );
    metricsPanel.props.onComplete();
    expect(onModuleComplete).toHaveBeenCalledWith("metrics");
  });

  it("mirror wires onComplete directly to onMirrorComplete, never through onModuleComplete", () => {
    const onModuleComplete = vi.fn();
    const onMirrorComplete = vi.fn();
    const panel = panelOf(
      { ...initialOnboardingState, loading: false, modules: PHASE_THREE_METRICS_DONE, stage: "done" },
      [],
      { onModuleComplete, onMirrorComplete }
    );
    expect(panel.type).toBe(MirrorPanel);
    panel.props.onComplete();
    expect(onMirrorComplete).toHaveBeenCalledTimes(1);
    expect(onModuleComplete).not.toHaveBeenCalled();
  });
});

describe("navigateToProfile — mirror's terminal redirect (V3A_DESIGN.md §4 build item 4)", () => {
  it("assigns /profile through the injected assign function", () => {
    const assign = vi.fn();
    navigateToProfile(assign);
    expect(assign).toHaveBeenCalledWith("/profile");
    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe("DoneForNowView", () => {
  it("links to /feed and includes a manual Run-my-hunt control", () => {
    const view = DoneForNowView({ matchCount: 0 });
    const [, , actionsRow] = view.props.children;
    const [feedLink, runHuntButton] = actionsRow.props.children;
    expect(feedLink.props.href).toBe("/feed");
    expect(runHuntButton).toBeTruthy();
  });

  it("shows the match count only when > 0 (never claims a count that isn't true)", () => {
    const withMatches = DoneForNowView({ matchCount: 3 });
    expect(withMatches.props.children[3].props.children).toEqual([3, " matches waiting now."]);
    const withoutMatches = DoneForNowView({ matchCount: 0 });
    expect(withoutMatches.props.children[3]).toBeFalsy();
  });
});

describe("ChatStageView — motion classes wired to ONB-C's utilities", () => {
  it("each message carries the message-enter class; the panel wrapper carries panel-enter", () => {
    const state: OnboardingState = {
      ...initialOnboardingState,
      loading: false,
      modules: PHASE_TWO_STRUCTURED_DONE,
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

describe("RESUME_SKIP_MESSAGE — page consumes ONB-A's exported sentinel, doesn't redefine it", () => {
  it("is the string handleTurn.ts special-cases", () => {
    expect(RESUME_SKIP_MESSAGE).toBe("__skip_resume__");
  });
});
