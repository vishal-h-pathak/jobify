"use client";

import { useEffect, useReducer, useRef } from "react";
import type { RefObject } from "react";
import Link from "next/link";
import { Button, BUTTON_VARIANT_CLASSES } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextArea } from "@/components/ui/Input";
import { FileButton } from "@/components/ui/FileButton";
import { Banner } from "@/components/ui/Banner";
import { CALIBRATION_INTRO_COPY } from "@/lib/anthropic/interview";
import type { ChatMessage, InterviewStage } from "@/lib/anthropic/interview";
import { RESUME_SKIP_MESSAGE } from "@/lib/onboarding/handleTurn";
import { deriveSpineSteps, StepSpine, type SpineReceipts } from "@/components/onboarding/StepSpine";
import {
  AnchorForm,
  anchorFormValid,
  anchorReceiptFor,
  buildAnchorPayload,
  initialAnchorFormValues,
  type AnchorFormValues,
} from "@/components/onboarding/AnchorForm";
import {
  CalibrationGeneratingSkeleton,
  CalibrationPanel,
  calibrationAnswersValid,
  formatCalibrationSubmission,
  parseCalibrationPrompts,
} from "@/components/onboarding/CalibrationPanel";

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
}

/* ------------------------------------------------------------------ */
/* Pure helpers — no hooks, no DOM. Kept dependency-injected (fetchImpl) */
/* so every network path is directly unit-testable, matching this      */
/* repo's convention (see lib/onboarding/handleTurn.test.ts).           */
/* ------------------------------------------------------------------ */

const ALLOWED_UPLOAD_EXTENSIONS = [".txt", ".md"];

/** Returns a friendly rejection message, or null if the filename is allowed. */
export function validateUploadName(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  const ok = ALLOWED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
  return ok ? null : "Please upload a .txt or .md file.";
}

export type UploadResult = { ok: true; text: string } | { ok: false; error: string };

/** Validates the extension, then reads the file's text client-side. */
export async function handleUpload(file: File): Promise<UploadResult> {
  const error = validateUploadName(file.name);
  if (error) return { ok: false, error };
  const text = await file.text();
  return { ok: true, text };
}

export async function fetchInitialState(fetchImpl: typeof fetch = fetch): Promise<InitialState> {
  const res = await fetchImpl("/api/onboarding/state");
  if (!res.ok) throw new Error("Could not load your session.");
  const data = await res.json();
  return {
    messages: (data.messages ?? []) as ChatMessage[],
    stage: (data.stage ?? "anchor") as InterviewStage,
    done: data.status === "complete",
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

const RESUME_ADDED_RECEIPT = "resume added";
const RESUME_SKIPPED_RECEIPT = "skipped — built from your answers";
const CALIBRATION_RECEIPT = "4 answers";

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

  receipts: SpineReceipts;
}

export const initialOnboardingState: OnboardingState = {
  loading: true,
  loadError: "",
  messages: [],
  stage: "anchor",
  done: false,
  validation: undefined,

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

  receipts: {},
};

export type OnboardingAction =
  | { type: "state_loaded"; messages: ChatMessage[]; stage: InterviewStage; done: boolean }
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
      receiptUpdate?: Partial<SpineReceipts>;
    }
  | { type: "turn_failed"; error: string }
  | { type: "upload_rejected"; error: string }
  | { type: "upload_accepted"; fileName: string; text: string }
  | { type: "anchor_field_changed"; field: keyof Omit<AnchorFormValues, "mode">; value: string }
  | { type: "anchor_mode_toggled" }
  | { type: "anchor_submit_started" }
  | { type: "anchor_submit_succeeded"; receipt: string }
  | { type: "anchor_submit_failed"; error: string }
  | { type: "calibration_answer_changed"; index: number; value: string };

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
        calibrationGenerating: false,
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
        receipts: action.receiptUpdate ? { ...state.receipts, ...action.receiptUpdate } : state.receipts,
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
    case "anchor_submit_succeeded":
      return {
        ...state,
        anchorSubmitting: false,
        stage: "calibration",
        calibrationGenerating: true,
        receipts: { ...state.receipts, anchor: action.receipt },
      };
    case "anchor_submit_failed":
      // Deliberately does NOT touch `anchorValues` — the typed form survives
      // the failure so the user can just retry the same submit.
      return { ...state, anchorSubmitting: false, anchorError: action.error };
    case "calibration_answer_changed": {
      const next = [...state.calibrationAnswers];
      next[action.index] = action.value;
      return { ...state, calibrationAnswers: next };
    }
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* Presentational views — plain functions of props, no hooks/effects of */
/* their own (the scroll ref is created upstream and only *attached*    */
/* here), matching this repo's direct-invocation test style (see        */
/* FileButton.test.tsx / layout.test.tsx). Split per stage so each is   */
/* independently testable and the staged shell (ONBOARDING_REDESIGN.md  */
/* §3) reads as a panel swap, not one big branching blob.               */
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

/** Chat restyle (§3): assistant messages drop the Card for plain text with a
 * 2px amber left rule; the active (last, unanswered) question renders larger
 * than the historical transcript. Upload + Skip render only in the resume
 * stage; placeholder copy is stage-driven. */
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
              accept=".txt,.md"
              label="Upload resume (.txt/.md)"
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

export interface DoneViewProps {
  messages: ChatMessage[];
  validation?: Validation;
}

/** The done-state summary moment (§3): the final turn's plain-words recap —
 * rank-up / never-show / logistics, content already mandated by the system
 * prompt (interview.ts:130-133) — rendered as its own paragraphs, plus the
 * primary "Run my first hunt" action. */
export function DoneView({ messages, validation }: DoneViewProps) {
  const summaryText = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const paragraphs = summaryText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <Card variant="elevated" className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight text-ink">
        {validation?.status === "invalid" ? "Profile saved, but needs a fix:" : "Your profile is built."}
      </h2>
      {validation?.status === "invalid" && (
        <ul className="list-disc pl-5 text-sm text-danger">
          {validation.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3 text-ink-muted">
        {paragraphs.map((p, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {p}
          </p>
        ))}
      </div>
      <Link
        href="/feed"
        className={`inline-flex w-fit items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${BUTTON_VARIANT_CLASSES.primary}`}
      >
        Run my first hunt
      </Link>
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
}

function renderStagePanel(props: OnboardingViewProps) {
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
  } = props;

  switch (state.stage) {
    case "anchor":
      return (
        <AnchorForm
          values={state.anchorValues}
          submitting={state.anchorSubmitting}
          error={state.anchorError}
          onFieldChange={onAnchorFieldChange}
          onModeToggle={onAnchorModeToggle}
          onSubmit={onAnchorSubmit}
        />
      );
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
    case "done":
      return <DoneView messages={state.messages} validation={state.validation} />;
    case "resume":
    case "targeting":
    case "identity":
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

/** The staged shell (§3): one route, a panel per stage swapped via the
 * panel-enter motion utility, no outer bordered transcript box — the page
 * itself scrolls. StepSpine replaces the badge-arrow rail. */
export function OnboardingView(props: OnboardingViewProps) {
  const { state } = props;

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

  const spineSteps = deriveSpineSteps(state.stage, state.receipts);

  return (
    <div className="relative flex flex-1 flex-col">
      <div aria-hidden="true" className="amber-radial-glow pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
        <StepSpine steps={spineSteps} />
        <div key={state.stage} className="panel-enter flex flex-1 flex-col">
          {renderStagePanel(props)}
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

  // No outer scrollable transcript box (§3: "the page itself scrolls") — the
  // sentinel div at the bottom of the chat stage's message list is what gets
  // scrolled into view instead of an inner `overflow-y-auto` pane.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [state.messages.length, state.sending]);

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
        receiptUpdate: state.stage === "resume" ? { resume: RESUME_ADDED_RECEIPT } : undefined,
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
        receiptUpdate: { resume: RESUME_SKIPPED_RECEIPT },
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
      dispatch({ type: "anchor_submit_succeeded", receipt: anchorReceiptFor(state.anchorValues) });
      // The 4 calibration prompts are generated lazily inside GET /state
      // itself (maybeGenerateCalibrationPrompts) — this follow-up fetch is
      // what actually pays for and waits out that ~5-10s call.
      const data = await fetchInitialState();
      dispatch({ type: "state_loaded", ...data });
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
        receiptUpdate: { calibration: CALIBRATION_RECEIPT },
      });
    } catch (err) {
      dispatch({ type: "turn_failed", error: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  const calibrationPrompts = parseCalibrationPrompts(state.messages);

  return (
    <OnboardingView
      state={state}
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
    />
  );
}
