"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Input";

export interface EnergyState {
  hoursDisappear: string;
  keptPuttingOff: string;
  phase: "editing" | "submitting" | "error" | "finished";
  error: string | null;
}

export function initialEnergyState(): EnergyState {
  return { hoursDisappear: "", keptPuttingOff: "", phase: "editing", error: null };
}

export type EnergyAction =
  | { type: "hours_disappear_changed"; value: string }
  | { type: "kept_putting_off_changed"; value: string }
  | { type: "submit_started" }
  | { type: "submit_succeeded" }
  | { type: "submit_failed"; error: string };

export function energyReducer(state: EnergyState, action: EnergyAction): EnergyState {
  switch (action.type) {
    case "hours_disappear_changed":
      return { ...state, hoursDisappear: action.value };
    case "kept_putting_off_changed":
      return { ...state, keptPuttingOff: action.value };
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

export function energyFormValid(state: EnergyState): boolean {
  return state.hoursDisappear.trim().length > 0 && state.keptPuttingOff.trim().length > 0;
}

export async function submitEnergy(
  hoursDisappear: string,
  keptPuttingOff: string,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; key: string; receipt: string }> {
  const res = await fetchImpl("/api/onboarding/modules/energy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hours_disappear: hoursDisappear.trim(), kept_putting_off: keptPuttingOff.trim() }),
  });
  if (!res.ok) throw new Error("failed to submit energy");
  return res.json();
}

export interface EnergyPanelProps {
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

/** PRODUCT_VISION.md §2 item 6 — two behavioral questions, zero LLM. */
export function EnergyPanel({ onComplete, fetchImpl = fetch }: EnergyPanelProps) {
  const [state, dispatch] = useReducer(energyReducer, undefined, initialEnergyState);
  const canSubmit = energyFormValid(state) && state.phase === "editing";

  function handleSubmit() {
    if (!canSubmit) return;
    dispatch({ type: "submit_started" });
    submitEnergy(state.hoursDisappear, state.keptPuttingOff, fetchImpl)
      .then(() => dispatch({ type: "submit_succeeded" }))
      .catch((err) => dispatch({ type: "submit_failed", error: err instanceof Error ? err.message : "failed" }));
  }

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-sm text-ink">Last month: which task made hours disappear?</span>
        <TextArea
          value={state.hoursDisappear}
          onChange={(e) => dispatch({ type: "hours_disappear_changed", value: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm text-ink">Which did you keep putting off?</span>
        <TextArea
          value={state.keptPuttingOff}
          onChange={(e) => dispatch({ type: "kept_putting_off_changed", value: e.target.value })}
        />
      </label>
      {state.error && <div className="text-sm text-danger">{state.error}</div>}
      <Button variant="primary" disabled={!canSubmit} busy={state.phase === "submitting"} onClick={handleSubmit}>
        Continue
      </Button>
    </div>
  );
}
