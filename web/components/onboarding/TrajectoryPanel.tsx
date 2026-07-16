"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Input";

export type TrajectoryDirection = "climb" | "switch" | "stabilize" | "experiment";

export const TRAJECTORY_OPTIONS: { direction: TrajectoryDirection; label: string }[] = [
  { direction: "climb", label: "Climb — bigger scope, bigger title" },
  { direction: "switch", label: "Switch ladders — different track entirely" },
  { direction: "stabilize", label: "Same rung, better terms" },
  { direction: "experiment", label: "Deliberately experimenting" },
];

export interface TrajectoryState {
  direction: TrajectoryDirection | null;
  freeText: string;
  phase: "editing" | "submitting" | "error" | "finished";
  error: string | null;
}

export function initialTrajectoryState(): TrajectoryState {
  return { direction: null, freeText: "", phase: "editing", error: null };
}

export type TrajectoryAction =
  | { type: "direction_chosen"; direction: TrajectoryDirection }
  | { type: "free_text_changed"; value: string }
  | { type: "submit_started" }
  | { type: "submit_succeeded" }
  | { type: "submit_failed"; error: string };

export function trajectoryReducer(state: TrajectoryState, action: TrajectoryAction): TrajectoryState {
  switch (action.type) {
    case "direction_chosen":
      return { ...state, direction: action.direction };
    case "free_text_changed":
      return { ...state, freeText: action.value };
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

export async function submitTrajectory(
  direction: TrajectoryDirection,
  freeText: string,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; key: string; receipt: string }> {
  const res = await fetchImpl("/api/onboarding/modules/trajectory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ direction, ...(freeText.trim() ? { free_text: freeText.trim() } : {}) }),
  });
  if (!res.ok) throw new Error("failed to submit trajectory");
  return res.json();
}

export interface TrajectoryPanelProps {
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

/** PRODUCT_VISION.md §2 item 8 — three years out, enum + optional context. */
export function TrajectoryPanel({ onComplete, fetchImpl = fetch }: TrajectoryPanelProps) {
  const [state, dispatch] = useReducer(trajectoryReducer, undefined, initialTrajectoryState);
  const canSubmit = state.direction !== null && state.phase === "editing";

  function handleSubmit() {
    if (!state.direction || state.phase !== "editing") return;
    dispatch({ type: "submit_started" });
    submitTrajectory(state.direction, state.freeText, fetchImpl)
      .then(() => dispatch({ type: "submit_succeeded" }))
      .catch((err) => dispatch({ type: "submit_failed", error: err instanceof Error ? err.message : "failed" }));
  }

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {TRAJECTORY_OPTIONS.map((option) => (
          <button
            key={option.direction}
            type="button"
            onClick={() => dispatch({ type: "direction_chosen", direction: option.direction })}
            className={`rounded-lg border p-3 text-left text-sm text-ink transition-colors ${
              state.direction === option.direction ? "border-amber" : "border-line hover:border-ink-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <TextArea
        value={state.freeText}
        onChange={(e) => dispatch({ type: "free_text_changed", value: e.target.value })}
        placeholder="Anything else about where you're headed? (optional)"
      />
      {state.error && <div className="text-sm text-danger">{state.error}</div>}
      <Button variant="primary" disabled={!canSubmit} busy={state.phase === "submitting"} onClick={handleSubmit}>
        Continue
      </Button>
    </div>
  );
}
