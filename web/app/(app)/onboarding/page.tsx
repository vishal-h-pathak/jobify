"use client";

import { useEffect, useReducer, useRef } from "react";
import type { RefObject } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextArea } from "@/components/ui/Input";
import { FileButton } from "@/components/ui/FileButton";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { SEEDED_GREETING } from "@/lib/anthropic/interview";
import type { ChatMessage, InterviewStage } from "@/lib/anthropic/interview";

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
/* Pure helpers — no hooks, no DOM. Exported so page.test.tsx can drive */
/* every branch of logic directly, matching this repo's existing      */
/* convention of unit-testing extracted pure functions (see           */
/* lib/onboarding/handleTurn.test.ts) rather than mounting a renderer. */
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

/**
 * On a brand-new session (never had a real turn) `messages` comes back
 * empty from GET state — render the seeded greeting locally as the first
 * assistant bubble. It is never POSTed anywhere and never touches state
 * that gets persisted. A resumed session already has the greeting
 * persisted (Task 1's handleTurn.ts prepend), so it's returned unchanged.
 *
 * The optimistic `turn_succeeded` reducer case appends to whatever
 * `state.messages` started as (often `[]`), so after the first reply the
 * transcript can be non-empty *and* still missing the greeting at index 0
 * (the POST /api/onboarding/turn response never echoes the full messages
 * array back for the client to reconcile against). Detect that case by
 * checking the first message, not just emptiness, so the greeting is
 * prepended whenever it isn't already there.
 */
export function buildDisplayMessages(messages: ChatMessage[]): ChatMessage[] {
  const hasGreeting = messages.length > 0 && messages[0].role === "assistant" && messages[0].content === SEEDED_GREETING;
  if (hasGreeting) return messages;
  return [{ role: "assistant", content: SEEDED_GREETING }, ...messages];
}

export type RailStepStatus = "complete" | "current" | "upcoming";
export interface RailStep {
  label: string;
  status: RailStepStatus;
}

export const RAIL_LABELS = ["About you", "Resume", "Basics", "Targeting", "Done"] as const;

/**
 * Maps the backend's 4 stage values onto the 5-label rail. `resume` splits
 * into two rail states based on how many assistant messages have been
 * shown so far (counting the seeded greeting as the first one): <=2 means
 * only the opening + at most one interest follow-up have happened ("About
 * you" is current); >=3 means the assistant has moved on to asking for the
 * resume ("Resume" is current, "About you" complete).
 */
export function computeRailSteps(stage: InterviewStage, assistantMessageCount: number): RailStep[] {
  const currentIndex =
    stage === "done" ? 4 : stage === "targeting" ? 3 : stage === "identity" ? 2 : assistantMessageCount >= 3 ? 1 : 0;

  return RAIL_LABELS.map((label, i) => ({
    label,
    status: i < currentIndex ? "complete" : i === currentIndex ? "current" : "upcoming",
  }));
}

function railTone(status: RailStepStatus): BadgeTone {
  if (status === "complete") return "success";
  if (status === "current") return "amber";
  return "neutral";
}

export async function fetchInitialState(fetchImpl: typeof fetch = fetch): Promise<InitialState> {
  const res = await fetchImpl("/api/onboarding/state");
  if (!res.ok) throw new Error("Could not load your session.");
  const data = await res.json();
  return {
    messages: (data.messages ?? []) as ChatMessage[],
    stage: (data.stage ?? "resume") as InterviewStage,
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

/* ------------------------------------------------------------------ */
/* State machine — a pure reducer so every transition (including the   */
/* "don't lose the draft on failure" rule) is directly unit-testable.  */
/* ------------------------------------------------------------------ */

export interface OnboardingState {
  loading: boolean;
  loadError: string;
  messages: ChatMessage[];
  stage: InterviewStage;
  input: string;
  sending: boolean;
  done: boolean;
  validation?: Validation;
  turnError: string;
  uploadError: string | null;
  fileName: string | null;
}

export const initialOnboardingState: OnboardingState = {
  loading: true,
  loadError: "",
  messages: [],
  stage: "resume",
  input: "",
  sending: false,
  done: false,
  validation: undefined,
  turnError: "",
  uploadError: null,
  fileName: null,
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
    }
  | { type: "turn_failed"; error: string }
  | { type: "upload_rejected"; error: string }
  | { type: "upload_accepted"; fileName: string; text: string };

export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "state_loaded":
      return { ...state, loading: false, loadError: "", messages: action.messages, stage: action.stage, done: action.done };
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
      // Deliberately does NOT touch `input` — a failed request must not
      // drop the user's draft; the composer keeps it and Retry resends it.
      return { ...state, sending: false, turnError: action.error };
    case "upload_rejected":
      // Deliberately does NOT touch `input` — a rejected file must not
      // populate the composer with its contents.
      return { ...state, uploadError: action.error };
    case "upload_accepted":
      return { ...state, uploadError: null, fileName: action.fileName, input: action.text };
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* Presentational view — a plain function of props, no hooks/effects/  */
/* refs of its own (the scroll ref is created upstream by the page and */
/* only *attached* here). Kept hook-free on purpose so page.test.tsx   */
/* can call it directly and inspect the returned element tree, the     */
/* same direct-invocation style this repo already uses for FileButton  */
/* and the (app) layout (see FileButton.test.tsx / layout.test.tsx).   */
/* Mounting a real DOM renderer isn't an option here: this repo's      */
/* vitest config runs in the `node` environment and neither jsdom nor  */
/* @testing-library/react is installed.                                */
/* ------------------------------------------------------------------ */

/** Shared by both the transcript's user bubbles and the optimistic in-flight echo bubble. */
const USER_BUBBLE_CLASS =
  "max-w-[85%] self-end rounded-lg border border-amber/30 bg-amber/15 px-3 py-2 text-sm text-ink";

export interface OnboardingViewProps {
  state: OnboardingState;
  transcript: ChatMessage[];
  railSteps: RailStep[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onFileChange: (file: File) => void;
}

export function OnboardingView({
  state,
  transcript,
  railSteps,
  scrollRef,
  onInputChange,
  onSend,
  onRetry,
  onFileChange,
}: OnboardingViewProps) {
  if (state.loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-6 w-6 text-ink-muted" />
      </div>
    );
  }

  if (state.loadError) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-start px-6 py-10">
        <Banner tone="danger">{state.loadError}</Banner>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Building your profile</h1>

      <div className="flex items-center gap-2 overflow-x-auto text-xs">
        {railSteps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-2">
            <Badge tone={railTone(step.status)}>{step.label}</Badge>
            {i < railSteps.length - 1 && <span className="text-ink-muted">→</span>}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-line p-4"
      >
        {transcript.map((m, i) =>
          m.role === "assistant" ? (
            <Card key={i} className="max-w-[85%] self-start">
              <p className="whitespace-pre-wrap text-sm text-ink">{m.content}</p>
            </Card>
          ) : (
            <div key={i} className={USER_BUBBLE_CLASS}>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          )
        )}
        {state.sending && (
          <>
            <div className={USER_BUBBLE_CLASS}>
              <p className="whitespace-pre-wrap">{state.input}</p>
            </div>
            <div
              className="flex items-center gap-1 self-start rounded-lg bg-surface px-3 py-2.5"
              role="status"
              aria-label="Assistant is typing"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:300ms]" />
            </div>
          </>
        )}
      </div>

      {state.done ? (
        <Card className="flex flex-col gap-2">
          <p className="font-medium text-ink">
            {state.validation?.status === "invalid" ? "Profile saved, but needs a fix:" : "Your profile is built."}
          </p>
          {state.validation?.status === "invalid" && (
            <ul className="list-disc pl-5 text-sm text-danger">
              {state.validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <Link href="/feed" className="text-sm font-medium text-amber underline">
            Go to your feed
          </Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
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
            placeholder="Type your reply… (Enter to send, Shift+Enter for a new line)"
            rows={3}
            disabled={state.sending}
          />
          <div className="flex items-center justify-between gap-3">
            <FileButton
              id="onboarding-resume-upload"
              fileName={state.fileName}
              onFileChange={onFileChange}
              accept=".txt,.md"
              label="Upload resume (.txt/.md)"
            />
            <Button variant="primary" busy={state.sending} disabled={state.sending || !state.input.trim()} onClick={onSend}>
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component — owns the hooks (reducer, initial-fetch effect, scroll   */
/* ref) and hands the derived data + closures to OnboardingView.       */
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

  const transcript = buildDisplayMessages(state.messages);
  const assistantMessageCount = transcript.filter((m) => m.role === "assistant").length;
  const railSteps = computeRailSteps(state.stage, assistantMessageCount);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript.length, state.sending]);

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

  async function handleFile(file: File) {
    const result = await handleUpload(file);
    if (!result.ok) {
      dispatch({ type: "upload_rejected", error: result.error });
      return;
    }
    dispatch({ type: "upload_accepted", fileName: file.name, text: result.text });
  }

  return (
    <OnboardingView
      state={state}
      transcript={transcript}
      railSteps={railSteps}
      scrollRef={scrollRef}
      onInputChange={(value) => dispatch({ type: "input_changed", value })}
      onSend={handleSend}
      onRetry={handleSend}
      onFileChange={handleFile}
    />
  );
}
