"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Input";

export type VoiceMode = "paste" | "fresh";

export interface VoiceState {
  mode: VoiceMode;
  text: string;
  phase: "editing" | "submitting" | "error" | "finished";
  error: string | null;
}

export function initialVoiceState(): VoiceState {
  return { mode: "paste", text: "", phase: "editing", error: null };
}

export type VoiceAction =
  | { type: "mode_changed"; mode: VoiceMode }
  | { type: "text_changed"; value: string }
  | { type: "submit_started" }
  | { type: "submit_succeeded" }
  | { type: "submit_failed"; error: string };

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "mode_changed":
      return { ...state, mode: action.mode };
    case "text_changed":
      return { ...state, text: action.value };
    case "submit_started":
      return { ...state, phase: "submitting", error: null };
    case "submit_succeeded":
      return { ...state, phase: "finished" };
    case "submit_failed":
      return { ...state, phase: "editing", error: action.error };
    default:
      return state;
  }
}

/** No minimum-length gate beyond non-empty — the design's 200-2000 char
 * guidance is copy, not an enforced constraint (V3A_DESIGN.md §2.1). */
export function voiceFormValid(state: VoiceState): boolean {
  return state.text.trim().length > 0;
}

export async function submitVoice(
  text: string,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; key: string; receipt: string }> {
  const res = await fetchImpl("/api/onboarding/modules/voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sample: text.trim() }),
  });
  if (!res.ok) throw new Error("failed to submit voice sample");
  return res.json();
}

export interface VoicePanelProps {
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

const FRESH_PROMPT_COPY = "Explain what you actually do to a friend — like you'd text it. Three or four sentences.";
const SAMPLE_PLACEHOLDER = "Typos fine. This is about how you sound.";

/** V3A_DESIGN.md §2.1 — one LLM turn, ingests a writing sample into
 * `voice-profile.md`. Two tabs share a single text field; switching tabs
 * only changes the guidance copy shown above the textarea. */
export function VoicePanel({ onComplete, fetchImpl = fetch }: VoicePanelProps) {
  const [state, dispatch] = useReducer(voiceReducer, undefined, initialVoiceState);
  const canSubmit = voiceFormValid(state) && state.phase === "editing";

  function handleSubmit() {
    if (!canSubmit) return;
    dispatch({ type: "submit_started" });
    submitVoice(state.text, fetchImpl)
      .then(() => dispatch({ type: "submit_succeeded" }))
      .catch((err) => dispatch({ type: "submit_failed", error: err instanceof Error ? err.message : "failed" }));
  }

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={state.mode === "paste"}
          onClick={() => dispatch({ type: "mode_changed", mode: "paste" })}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            state.mode === "paste" ? "border-amber bg-amber/10 text-ink" : "border-line text-ink-muted hover:border-ink-muted"
          }`}
        >
          Paste something you wrote
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.mode === "fresh"}
          onClick={() => dispatch({ type: "mode_changed", mode: "fresh" })}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            state.mode === "fresh" ? "border-amber bg-amber/10 text-ink" : "border-line text-ink-muted hover:border-ink-muted"
          }`}
        >
          Write it fresh
        </button>
      </div>

      {state.mode === "paste" ? (
        <p className="text-sm text-ink-muted">
          An email, a doc excerpt, a post — anything you wrote. Strip anything confidential first.
        </p>
      ) : (
        <p className="text-sm text-ink-muted">{FRESH_PROMPT_COPY}</p>
      )}

      <TextArea
        value={state.text}
        onChange={(e) => dispatch({ type: "text_changed", value: e.target.value })}
        placeholder={SAMPLE_PLACEHOLDER}
        disabled={state.phase === "submitting"}
      />

      {state.error && <div className="text-sm text-danger">{state.error}</div>}
      <Button variant="primary" disabled={!canSubmit} busy={state.phase === "submitting"} onClick={handleSubmit}>
        Continue
      </Button>
    </div>
  );
}
