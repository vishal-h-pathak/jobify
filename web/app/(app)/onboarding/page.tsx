"use client";

import { useEffect, useReducer, useRef } from "react";
import type { RefObject } from "react";
import { Button, BUTTON_VARIANT_CLASSES } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextArea } from "@/components/ui/Input";
import { FileButton } from "@/components/ui/FileButton";
import { Banner } from "@/components/ui/Banner";
import { CALIBRATION_INTRO_COPY } from "@/lib/anthropic/interview";
import type { ChatMessage, InterviewStage } from "@/lib/anthropic/interview";
import { RESUME_SKIP_MESSAGE } from "@/lib/onboarding/handleTurn";
import type { ModuleKey, ModulesState } from "@/lib/onboarding/moduleRegistry";
import {
  AnchorForm,
  anchorFormValid,
  buildAnchorPayload,
  initialAnchorFormValues,
  type AnchorFormValues,
} from "@/components/onboarding/AnchorForm";
import { DISCLOSURE_COPY } from "@/lib/admin/disclosureCopy";
import {
  CalibrationGeneratingSkeleton,
  CalibrationPanel,
  calibrationAnswersValid,
  formatCalibrationSubmission,
  parseCalibrationPrompts,
} from "@/components/onboarding/CalibrationPanel";
import { PhaseRail } from "@/components/onboarding/PhaseRail";
import { deriveNextModule, isModuleComplete } from "@/components/onboarding/moduleOrder";
import { ReactionDeck, REACTION_DECK_INTRO_COPY } from "@/components/onboarding/ReactionDeck";
import { ValuePairsPanel, type ValuePairDef } from "@/components/onboarding/ValuePairsPanel";
import { DealbreakersPanel } from "@/components/onboarding/DealbreakersPanel";
import { EnergyPanel } from "@/components/onboarding/EnergyPanel";
import { EnvironmentPanel, type EnvironmentScenarioDef } from "@/components/onboarding/EnvironmentPanel";
import { TrajectoryPanel } from "@/components/onboarding/TrajectoryPanel";
import { CheckpointInterstitial } from "@/components/onboarding/CheckpointInterstitial";
import { VoicePanel } from "@/components/onboarding/VoicePanel";
import { MetricsPanel } from "@/components/onboarding/MetricsPanel";
import { MirrorPanel } from "@/components/onboarding/MirrorPanel";
import { RunHuntButton } from "@/app/(app)/feed/RunHuntButton";
import { useWelcomeBack } from "../WelcomeBackContext";
import type { WelcomeBackInfo } from "@/lib/onboarding/welcomeBack";

export interface Validation {
  status: "valid" | "invalid";
  errors: string[];
}

interface TurnResponse {
  assistantText: string;
  stage: InterviewStage;
  done: boolean;
  validation?: Validation;
}

interface InitialState {
  messages: ChatMessage[];
  stage: InterviewStage;
  done: boolean;
  modules: ModulesState;
  matchCount: number;
  valuePairs: ValuePairDef[];
  environmentScenarios: EnvironmentScenarioDef[];
}

/* ------------------------------------------------------------------ */
/* Pure helpers — no hooks, no DOM. Kept dependency-injected (fetchImpl) */
/* so every network path is directly unit-testable, matching this      */
/* repo's convention (see lib/onboarding/handleTurn.test.ts).           */
/* ------------------------------------------------------------------ */

const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".txt", ".md"];

/** Returns a friendly rejection message, or null if the filename is allowed. */
export function validateUploadName(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  const ok = ALLOWED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
  return ok ? null : "Please upload a .pdf, .txt, or .md file.";
}

export type UploadResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Validates the extension, then extracts the file's text. `.txt`/`.md`
 * still read client-side via `file.text()`, unchanged (judgment call #8);
 * `.pdf` POSTs to the new server-side `/api/resume/extract` route (the
 * PDF library never runs in the browser) and maps its JSON response onto
 * the same `UploadResult` shape. `fetchImpl` defaults to global `fetch`,
 * matching this file's existing DI convention (see `fetchInitialState`/
 * `submitTurn` above).
 */
export async function handleUpload(file: File, fetchImpl: typeof fetch = fetch): Promise<UploadResult> {
  const error = validateUploadName(file.name);
  if (error) return { ok: false, error };

  if (file.name.toLowerCase().endsWith(".pdf")) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchImpl("/api/resume/extract", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok !== true) {
      return { ok: false, error: typeof data?.error === "string" ? data.error : "Something went wrong." };
    }
    return { ok: true, text: data.text };
  }

  const text = await file.text();
  return { ok: true, text };
}

/**
 * V3A-B1: extended (V3A_DESIGN.md §1.2) to also return `modules` (server
 * truth for the rail + panel router), the match count for the ambient
 * status chip, and the values/environment scenario data (shipped via state
 * rather than a dedicated GET, per the design's either/or).
 */
export async function fetchInitialState(fetchImpl: typeof fetch = fetch): Promise<InitialState> {
  const res = await fetchImpl("/api/onboarding/state");
  if (!res.ok) throw new Error("Could not load your session.");
  const data = await res.json();
  return {
    messages: (data.messages ?? []) as ChatMessage[],
    stage: (data.stage ?? "anchor") as InterviewStage,
    done: data.status === "complete",
    modules: (data.modules ?? {}) as ModulesState,
    matchCount: typeof data.match_count === "number" ? data.match_count : 0,
    valuePairs: (data.value_pairs ?? []) as ValuePairDef[],
    environmentScenarios: (data.environment_scenarios ?? []) as EnvironmentScenarioDef[],
  };
}

export async function submitTurn(message: string, fetchImpl: typeof fetch = fetch): Promise<TurnResponse> {
  const res = await fetchImpl("/api/onboarding/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong.");
  }
  return res.json();
}

/** POST /api/onboarding/anchor — zero-LLM, advances stage straight to 'calibration'. */
export async function submitAnchor(
  payload: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<{ stage: InterviewStage }> {
  const res = await fetchImpl("/api/onboarding/anchor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong.");
  }
  return res.json();
}

// Matches the private RESUME_SKIP_DISPLAY_TEXT in
// web/lib/onboarding/handleTurn.ts (not exported — only RESUME_SKIP_MESSAGE
// is) so the optimistic bubble matches exactly what the server persists.
const RESUME_SKIP_DISPLAY_TEXT = "Skipped — using the anchor and range answers instead.";

/** Deep-link `?module=<key>` (V3A_DESIGN.md §1.2) only re-opens modules with
 * a dedicated redo panel — range/evidence/voice/metrics/mirror have no
 * standalone UI this wave (interview block is driven by `stage`; voice/
 * metrics/mirror are B2's). */
const REDOABLE_MODULE_KEYS: readonly ModuleKey[] = [
  "anchor",
  "reactions",
  "values",
  "dealbreakers",
  "energy",
  "environment",
  "trajectory",
];

/**
 * Pure and DI'd exactly like `submitTurn`/`submitAnchor` above, so mirror's
 * terminal redirect is directly unit-testable without jsdom (this repo's
 * vitest config runs in the `node` environment — `window` doesn't exist
 * there, so a real `window.location.assign` call can only be exercised
 * through injection, not by stubbing `window` in a test).
 */
export function navigateToProfile(assignImpl: (url: string) => void = (url) => window.location.assign(url)): void {
  assignImpl("/profile");
}

/** V3A_DESIGN.md §1.6 — the ambient re-rank surface: only ever states things
 * true in the DB (checkpoint_hunt.fired_at, or a real match count). */
export function deriveHuntStatusLabel(modules: ModulesState, matchCount: number): string | null {
  const checkpoint = modules.checkpoint_hunt;
  if (!checkpoint) return null;
  if (matchCount > 0) return `${matchCount} match${matchCount === 1 ? "" : "es"} waiting`;
  const firedAt = new Date(checkpoint.fired_at);
  const hh = String(firedAt.getHours()).padStart(2, "0");
  const mm = String(firedAt.getMinutes()).padStart(2, "0");
  return `hunt #1 running · ${hh}:${mm}`;
}

/* ------------------------------------------------------------------ */
/* State machine — a pure reducer so every transition (including the   */
/* "don't lose the draft on failure" rule) is directly unit-testable.  */
/* ------------------------------------------------------------------ */

export interface OnboardingState {
  loading: boolean;
  loadError: string;
  messages: ChatMessage[];
  stage: InterviewStage;
  done: boolean;
  validation?: Validation;

  modules: ModulesState;
  matchCount: number;
  valuePairs: ValuePairDef[];
  environmentScenarios: EnvironmentScenarioDef[];
  interstitialPending: boolean;
  redoModule: ModuleKey | null;

  input: string;
  sending: boolean;
  turnError: string;
  uploadError: string | null;
  fileName: string | null;

  anchorValues: AnchorFormValues;
  anchorSubmitting: boolean;
  anchorError: string;
  calibrationGenerating: boolean;

  calibrationAnswers: string[];
}

export const initialOnboardingState: OnboardingState = {
  loading: true,
  loadError: "",
  messages: [],
  stage: "anchor",
  done: false,
  validation: undefined,

  modules: {},
  matchCount: 0,
  valuePairs: [],
  environmentScenarios: [],
  interstitialPending: false,
  redoModule: null,

  input: "",
  sending: false,
  turnError: "",
  uploadError: null,
  fileName: null,

  anchorValues: initialAnchorFormValues,
  anchorSubmitting: false,
  anchorError: "",
  calibrationGenerating: false,

  calibrationAnswers: ["", "", "", ""],
};

export type OnboardingAction =
  | ({ type: "state_loaded" } & InitialState)
  | { type: "state_load_failed" }
  | { type: "input_changed"; value: string }
  | { type: "turn_started" }
  | {
      type: "turn_succeeded";
      userMessage: string;
      assistantText: string;
      stage: InterviewStage;
      done: boolean;
      validation?: Validation;
    }
  | { type: "turn_failed"; error: string }
  | { type: "upload_rejected"; error: string }
  | { type: "upload_accepted"; fileName: string; text: string }
  | { type: "anchor_field_changed"; field: keyof Omit<AnchorFormValues, "mode">; value: string }
  | { type: "anchor_mode_toggled" }
  | { type: "anchor_submit_started" }
  | { type: "anchor_submit_failed"; error: string }
  | { type: "calibration_answer_changed"; index: number; value: string }
  | { type: "checkpoint_interstitial_shown" }
  | { type: "checkpoint_interstitial_dismissed" }
  | { type: "redo_requested"; key: ModuleKey }
  | { type: "redo_cleared" };

export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "state_loaded":
      return {
        ...state,
        loading: false,
        loadError: "",
        messages: action.messages,
        stage: action.stage,
        done: action.done,
        modules: action.modules,
        matchCount: action.matchCount,
        valuePairs: action.valuePairs,
        environmentScenarios: action.environmentScenarios,
        calibrationGenerating: false,
        anchorSubmitting: false,
      };
    case "state_load_failed":
      return { ...state, loading: false, loadError: "Could not load your session." };
    case "input_changed":
      return { ...state, input: action.value };
    case "turn_started":
      return { ...state, sending: true, turnError: "" };
    case "turn_succeeded":
      return {
        ...state,
        sending: false,
        input: "",
        turnError: "",
        messages: [
          ...state.messages,
          { role: "user", content: action.userMessage },
          { role: "assistant", content: action.assistantText },
        ],
        stage: action.stage,
        done: action.done,
        validation: action.validation,
      };
    case "turn_failed":
      // Deliberately does NOT touch `input` (or `calibrationAnswers`) — a
      // failed request must not drop the user's draft; Retry resends it.
      return { ...state, sending: false, turnError: action.error };
    case "upload_rejected":
      // Deliberately does NOT touch `input` — a rejected file must not
      // populate the composer with its contents.
      return { ...state, uploadError: action.error };
    case "upload_accepted":
      return { ...state, uploadError: null, fileName: action.fileName, input: action.text };
    case "anchor_field_changed":
      return {
        ...state,
        anchorValues: { ...state.anchorValues, [action.field]: action.value },
        anchorError: "",
      };
    case "anchor_mode_toggled":
      return {
        ...state,
        anchorValues: { ...state.anchorValues, mode: state.anchorValues.mode === "role" ? "situation" : "role" },
      };
    case "anchor_submit_started":
      return { ...state, anchorSubmitting: true, anchorError: "" };
    case "anchor_submit_failed":
      // Deliberately does NOT touch `anchorValues` — the typed form survives
      // the failure so the user can just retry the same submit.
      return { ...state, anchorSubmitting: false, anchorError: action.error };
    case "calibration_answer_changed": {
      const next = [...state.calibrationAnswers];
      next[action.index] = action.value;
      return { ...state, calibrationAnswers: next };
    }
    case "checkpoint_interstitial_shown":
      return { ...state, interstitialPending: true };
    case "checkpoint_interstitial_dismissed":
      return { ...state, interstitialPending: false };
    case "redo_requested":
      return { ...state, redoModule: action.key };
    case "redo_cleared":
      return { ...state, redoModule: null };
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* Presentational views — plain functions of props, no hooks/effects of */
/* their own (the scroll ref is created upstream and only *attached*    */
/* here), matching this repo's direct-invocation test style (see        */
/* FileButton.test.tsx / layout.test.tsx).                              */
/* ------------------------------------------------------------------ */

export interface ChatStageViewProps {
  state: OnboardingState;
  scrollRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onFileChange: (file: File) => void;
  onSkip: () => void;
}

/** Chat restyle (ONBOARDING_REDESIGN.md §3): assistant messages drop the
 * Card for plain text with a 2px amber left rule; the active (last,
 * unanswered) question renders larger than the historical transcript.
 * Upload + Skip render only in the resume stage; placeholder copy is
 * stage-driven. This is the "interview block" (V3A_DESIGN.md §1.7)'s
 * resume/targeting sub-view. */
export function ChatStageView({ state, scrollRef, onInputChange, onSend, onRetry, onFileChange, onSkip }: ChatStageViewProps) {
  const placeholder =
    state.stage === "resume"
      ? "Paste your resume — or use Skip below if you'd rather not."
      : "Type your answer… (Enter to send, Shift+Enter for a new line)";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-1 flex-col gap-4">
        {state.messages.map((m, i) => {
          const isActiveQuestion = m.role === "assistant" && i === state.messages.length - 1;
          return m.role === "assistant" ? (
            <div
              key={i}
              className={`message-enter max-w-prose border-l-2 border-amber pl-4 leading-relaxed ${
                isActiveQuestion ? "text-lg text-ink" : "text-sm text-ink-muted"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ) : (
            <div
              key={i}
              className="message-enter max-w-[85%] self-end rounded-lg border border-amber/30 bg-amber/15 px-3 py-2 text-sm text-ink"
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          );
        })}
        {state.sending && (
          <div
            className="flex items-center gap-1 self-start rounded-lg bg-surface px-3 py-2.5"
            role="status"
            aria-label="Assistant is typing"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:300ms]" />
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {state.turnError && (
        <Banner tone="danger">
          <div className="flex items-center justify-between gap-3">
            <span>{state.turnError}</span>
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </Banner>
      )}
      {state.uploadError && <p className="text-sm text-danger">{state.uploadError}</p>}

      <TextArea
        value={state.input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        disabled={state.sending}
      />
      <div className="flex items-center justify-between gap-3">
        {state.stage === "resume" ? (
          <div className="flex items-center gap-3">
            <FileButton
              id="onboarding-resume-upload"
              fileName={state.fileName}
              onFileChange={onFileChange}
              accept=".pdf,.txt,.md"
              label="Upload resume (.pdf/.txt/.md)"
            />
            <Button variant="ghost" onClick={onSkip} disabled={state.sending}>
              Skip — use my answers instead
            </Button>
          </div>
        ) : (
          <div />
        )}
        <Button variant="primary" busy={state.sending} disabled={state.sending || !state.input.trim()} onClick={onSend}>
          Send
        </Button>
      </div>
    </div>
  );
}

/**
 * V3A_DESIGN.md §4 build item 6 — the fallback screen for once every
 * canonical module (including B2's voice/metrics/mirror) is complete.
 * Unreachable in the normal guided flow: mirror's own completion redirects
 * straight to /profile (`handleMirrorComplete`) before `deriveNextModule`
 * would ever return null here. Kept as the honest fallback for a stray
 * revisit of /onboarding after completion. Manual "Run my hunt" (owner
 * decision, 2026-07-06: no automatic hunt #2) plus the feed CTA.
 */
export function DoneForNowView({ matchCount }: { matchCount: number }) {
  return (
    <Card variant="elevated" className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight text-ink">Your profile is complete.</h2>
      <p className="text-ink-muted">Your feed is already live from what you&apos;ve told us.</p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/feed"
          className={`inline-flex w-fit items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${BUTTON_VARIANT_CLASSES.primary}`}
        >
          View my feed
        </a>
        <RunHuntButton />
      </div>
      {matchCount > 0 && <p className="text-sm text-ink-muted">{matchCount} matches waiting now.</p>}
    </Card>
  );
}

export interface OnboardingViewProps {
  state: OnboardingState;
  calibrationPrompts: string[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onFileChange: (file: File) => void;
  onSkip: () => void;
  onAnchorFieldChange: (field: keyof Omit<AnchorFormValues, "mode">, value: string) => void;
  onAnchorModeToggle: () => void;
  onAnchorSubmit: () => void;
  onCalibrationAnswerChange: (index: number, value: string) => void;
  onCalibrationSubmit: () => void;
  onModuleComplete: (key: ModuleKey) => void;
  onMirrorComplete: () => void;
  onCheckpointContinue: () => void;
  /** UX1_DESIGN.md §2: set only on a stale (>30 min) return visit — the
   * (app) layout derives this server-side and hands it down via context
   * (see OnboardingPage below), so this hook-free view stays directly
   * testable as a plain function call. */
  welcomeBack?: WelcomeBackInfo | null;
}

/**
 * V3A_DESIGN.md §1.2: the interview block (range -> evidence -> targeting)
 * has no module key of its own for "still mid-targeting" — `evidence`
 * derives complete as soon as the resume sub-stage ends (V3A_DESIGN.md §1.7),
 * which is BEFORE targeting begins. So panel routing can't just take
 * `deriveNextModule`'s first-incomplete-key verbatim once inside the block —
 * it has to keep showing the chat for the whole block, until `stage` itself
 * reaches 'done' (finish_interview).
 */
function isInterviewBlockActive(state: OnboardingState): boolean {
  return state.stage !== "anchor" && state.stage !== "done" && isModuleComplete("trajectory", state.modules, state.stage);
}

function renderActivePanel(props: OnboardingViewProps) {
  const {
    state,
    calibrationPrompts,
    scrollRef,
    onInputChange,
    onSend,
    onRetry,
    onFileChange,
    onSkip,
    onAnchorFieldChange,
    onAnchorModeToggle,
    onAnchorSubmit,
    onCalibrationAnswerChange,
    onCalibrationSubmit,
    onModuleComplete,
    onMirrorComplete,
  } = props;

  const activeModule: ModuleKey | null =
    state.redoModule ?? (isInterviewBlockActive(state) ? null : deriveNextModule(state.modules, state.stage));

  if (!activeModule && !isInterviewBlockActive(state)) {
    return <DoneForNowView matchCount={state.matchCount} />;
  }

  if (!activeModule) {
    // Interview block active — driven by `stage`, matching the pre-B1
    // (v2) chat stage machine exactly.
    switch (state.stage) {
      case "calibration":
        return state.calibrationGenerating ? (
          <CalibrationGeneratingSkeleton />
        ) : (
          <CalibrationPanel
            introCopy={CALIBRATION_INTRO_COPY}
            prompts={calibrationPrompts}
            answers={state.calibrationAnswers}
            submitting={state.sending}
            error={state.turnError}
            onAnswerChange={onCalibrationAnswerChange}
            onSubmit={onCalibrationSubmit}
          />
        );
      case "resume":
      case "targeting":
      default:
        return (
          <ChatStageView
            state={state}
            scrollRef={scrollRef}
            onInputChange={onInputChange}
            onSend={onSend}
            onRetry={onRetry}
            onFileChange={onFileChange}
            onSkip={onSkip}
          />
        );
    }
  }

  switch (activeModule) {
    case "anchor":
      return (
        <>
          <AnchorForm
            values={state.anchorValues}
            submitting={state.anchorSubmitting}
            error={state.anchorError}
            onFieldChange={onAnchorFieldChange}
            onModeToggle={onAnchorModeToggle}
            onSubmit={onAnchorSubmit}
          />
          {/* ONB-D handoff: beta disclosure rendered on the first screen
              (owner decision #2 — friends are told captures are reviewable). */}
          <p className="mt-6 text-xs text-ink-muted">{DISCLOSURE_COPY}</p>
        </>
      );
    case "reactions":
      return (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{REACTION_DECK_INTRO_COPY}</p>
          <ReactionDeck onComplete={() => onModuleComplete("reactions")} />
        </div>
      );
    case "values":
      return <ValuePairsPanel valuePairs={state.valuePairs} onComplete={() => onModuleComplete("values")} />;
    case "dealbreakers":
      return <DealbreakersPanel onComplete={() => onModuleComplete("dealbreakers")} />;
    case "energy":
      return <EnergyPanel onComplete={() => onModuleComplete("energy")} />;
    case "environment":
      return (
        <EnvironmentPanel scenarios={state.environmentScenarios} onComplete={() => onModuleComplete("environment")} />
      );
    case "trajectory":
      return <TrajectoryPanel onComplete={() => onModuleComplete("trajectory")} />;
    case "voice":
      return <VoicePanel onComplete={() => onModuleComplete("voice")} />;
    case "metrics":
      return <MetricsPanel onComplete={() => onModuleComplete("metrics")} />;
    case "mirror":
      return <MirrorPanel onComplete={onMirrorComplete} />;
    case "range":
    case "evidence":
    default:
      return <DoneForNowView matchCount={state.matchCount} />;
  }
}

/** The staged shell: one route, a panel per module swapped via the
 * panel-enter motion utility, no outer bordered transcript box — the page
 * itself scrolls. PhaseRail (V3A_DESIGN.md §1.1) replaces StepSpine. */
export function OnboardingView(props: OnboardingViewProps) {
  const { state, onCheckpointContinue, welcomeBack } = props;

  if (state.loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <div className="h-9 w-64 animate-pulse rounded bg-surface" />
        <div className="h-2 w-full animate-pulse rounded-full bg-line" />
        <div className="h-64 w-full animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

  if (state.loadError) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 items-start px-6 py-10">
        <Banner tone="danger">{state.loadError}</Banner>
      </div>
    );
  }

  const huntStatusLabel = deriveHuntStatusLabel(state.modules, state.matchCount);
  const panelKey =
    state.redoModule ??
    (state.interstitialPending ? "checkpoint" : deriveNextModule(state.modules, state.stage) ?? state.stage);

  return (
    <div className="relative flex flex-1 flex-col">
      <div aria-hidden="true" className="amber-radial-glow pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {welcomeBack && (
              <p className="mb-2 text-sm text-ink-muted">
                Welcome back — picking up at {welcomeBack.moduleLabel}.
              </p>
            )}
            <PhaseRail modules={state.modules} stage={state.stage} sweeping={state.interstitialPending} />
          </div>
          {huntStatusLabel && (
            <span className="mt-1 shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted">
              {huntStatusLabel}
            </span>
          )}
        </div>
        <div key={String(panelKey)} className="panel-enter flex flex-1 flex-col">
          {state.interstitialPending ? (
            <CheckpointInterstitial
              fired={Boolean(state.modules.checkpoint_hunt)}
              matchCount={state.matchCount}
              onContinue={onCheckpointContinue}
            />
          ) : (
            renderActivePanel(props)
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component — owns the hooks (reducer, initial-fetch effect, scroll    */
/* sentinel) and hands the derived data + closures to OnboardingView.   */
/* ------------------------------------------------------------------ */

export default function OnboardingPage() {
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const welcomeBack = useWelcomeBack();

  useEffect(() => {
    let cancelled = false;
    fetchInitialState()
      .then((data) => {
        if (!cancelled) dispatch({ type: "state_loaded", ...data });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "state_load_failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // V3A_DESIGN.md §1.2 deep-link resumability: read `?module=<key>` once on
  // mount via the plain browser API (not next/navigation's useSearchParams,
  // which would force a Suspense boundary on an already-fully-client page).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("module");
    if (requested && (REDOABLE_MODULE_KEYS as readonly string[]).includes(requested)) {
      dispatch({ type: "redo_requested", key: requested as ModuleKey });
    }
  }, []);

  // No outer scrollable transcript box (§3: "the page itself scrolls") — the
  // sentinel div at the bottom of the chat stage's message list is what gets
  // scrolled into view instead of an inner `overflow-y-auto` pane.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [state.messages.length, state.sending]);

  /**
   * V3A_DESIGN.md §1.2/§1.6: every module POST replaces `extracted[key]`
   * wholesale but returns only `{ok, key, receipt}` — not the session's
   * updated `modules`/`checkpoint_hunt`/match count. So the page re-fetches
   * `GET /state` (the one place that composes all of that) after every
   * completion, and branches the checkpoint interstitial on dealbreakers
   * specifically, since that's the module whose POST fires the checkpoint.
   */
  async function handleModuleComplete(key: ModuleKey) {
    const wasRedo = state.redoModule === key;
    try {
      const data = await fetchInitialState();
      dispatch({ type: "state_loaded", ...data });
    } catch {
      dispatch({ type: "state_load_failed" });
      return;
    }
    if (wasRedo) {
      dispatch({ type: "redo_cleared" });
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    if (key === "dealbreakers") dispatch({ type: "checkpoint_interstitial_shown" });
  }

  /**
   * Mirror is the last module in CANONICAL_MODULE_ORDER and its completion
   * is terminal (V3A_DESIGN.md §4 build item 4) — route straight to the
   * dossier rather than `handleModuleComplete`'s re-fetch-then-render-
   * DoneForNowView path, which would flash before any redirect. A hard
   * navigation (not next/navigation's useRouter) is fine here: onboarding
   * is finished, and this file already avoids next/navigation (see the
   * `?module=` comment above).
   */
  async function handleMirrorComplete() {
    navigateToProfile();
  }

  async function handleSend() {
    const message = state.input.trim();
    if (!message || state.sending) return;
    dispatch({ type: "turn_started" });
    try {
      const data = await submitTurn(message);
      dispatch({
        type: "turn_succeeded",
        userMessage: message,
        assistantText: data.assistantText,
        stage: data.stage,
        done: data.done,
        validation: data.validation,
      });
    } catch (err) {
      dispatch({ type: "turn_failed", error: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  async function handleSkip() {
    if (state.sending) return;
    dispatch({ type: "turn_started" });
    try {
      const data = await submitTurn(RESUME_SKIP_MESSAGE);
      dispatch({
        type: "turn_succeeded",
        userMessage: RESUME_SKIP_DISPLAY_TEXT,
        assistantText: data.assistantText,
        stage: data.stage,
        done: data.done,
        validation: data.validation,
      });
    } catch (err) {
      dispatch({ type: "turn_failed", error: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  async function handleFile(file: File) {
    const result = await handleUpload(file);
    if (!result.ok) {
      dispatch({ type: "upload_rejected", error: result.error });
      return;
    }
    dispatch({ type: "upload_accepted", fileName: file.name, text: result.text });
  }

  async function handleAnchorSubmit() {
    if (state.anchorSubmitting || !anchorFormValid(state.anchorValues)) return;
    dispatch({ type: "anchor_submit_started" });
    try {
      await submitAnchor(buildAnchorPayload(state.anchorValues));
      // The 4 calibration prompts are generated lazily inside GET /state
      // itself (maybeGenerateCalibrationPrompts) — this follow-up fetch is
      // what actually pays for and waits out that ~5-10s call, and also
      // picks up modules.anchor now that the anchor route marks it complete.
      await handleModuleComplete("anchor");
    } catch (err) {
      dispatch({ type: "anchor_submit_failed", error: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  async function handleCalibrationSubmit() {
    if (state.sending || !calibrationAnswersValid(state.calibrationAnswers)) return;
    dispatch({ type: "turn_started" });
    const message = formatCalibrationSubmission(state.calibrationAnswers);
    try {
      const data = await submitTurn(message);
      dispatch({
        type: "turn_succeeded",
        userMessage: message,
        assistantText: data.assistantText,
        stage: data.stage,
        done: data.done,
        validation: data.validation,
      });
    } catch (err) {
      dispatch({ type: "turn_failed", error: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  const calibrationPrompts = parseCalibrationPrompts(state.messages);

  return (
    <OnboardingView
      state={state}
      welcomeBack={welcomeBack}
      calibrationPrompts={calibrationPrompts}
      scrollRef={scrollRef}
      onInputChange={(value) => dispatch({ type: "input_changed", value })}
      onSend={handleSend}
      onRetry={handleSend}
      onFileChange={handleFile}
      onSkip={handleSkip}
      onAnchorFieldChange={(field, value) => dispatch({ type: "anchor_field_changed", field, value })}
      onAnchorModeToggle={() => dispatch({ type: "anchor_mode_toggled" })}
      onAnchorSubmit={handleAnchorSubmit}
      onCalibrationAnswerChange={(index, value) => dispatch({ type: "calibration_answer_changed", index, value })}
      onCalibrationSubmit={handleCalibrationSubmit}
      onModuleComplete={handleModuleComplete}
      onMirrorComplete={handleMirrorComplete}
      onCheckpointContinue={() => dispatch({ type: "checkpoint_interstitial_dismissed" })}
    />
  );
}
