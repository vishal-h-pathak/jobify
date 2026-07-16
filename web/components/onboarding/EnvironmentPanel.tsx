"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/Button";

export type EnvironmentScenarioKey = "team_size" | "pace" | "ambiguity" | "management_appetite";

export interface EnvironmentScenarioDef {
  key: EnvironmentScenarioKey;
  a: string;
  b: string;
}

export type EnvironmentSide = "a" | "b";
export type EnvironmentChoices = Partial<Record<EnvironmentScenarioKey, EnvironmentSide>>;

export interface EnvironmentState {
  choices: EnvironmentChoices;
  phase: "editing" | "submitting" | "error" | "finished";
  error: string | null;
}

export function initialEnvironmentState(): EnvironmentState {
  return { choices: {}, phase: "editing", error: null };
}

export type EnvironmentAction =
  | { type: "choice_made"; key: EnvironmentScenarioKey; side: EnvironmentSide }
  | { type: "submit_started" }
  | { type: "submit_succeeded" }
  | { type: "submit_failed"; error: string };

export function environmentReducer(state: EnvironmentState, action: EnvironmentAction): EnvironmentState {
  switch (action.type) {
    case "choice_made":
      return { ...state, choices: { ...state.choices, [action.key]: action.side } };
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

export function environmentFormValid(choices: EnvironmentChoices, scenarios: EnvironmentScenarioDef[]): boolean {
  return scenarios.every((s) => Boolean(choices[s.key]));
}

export async function submitEnvironment(
  choices: Record<EnvironmentScenarioKey, EnvironmentSide>,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; key: string; receipt: string }> {
  const res = await fetchImpl("/api/onboarding/modules/environment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(choices),
  });
  if (!res.ok) throw new Error("failed to submit environment");
  return res.json();
}

export interface EnvironmentPanelProps {
  scenarios: EnvironmentScenarioDef[];
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

/** PRODUCT_VISION.md §2 item 7 — four concrete either-or scenario pairs. */
export function EnvironmentPanel({ scenarios, onComplete, fetchImpl = fetch }: EnvironmentPanelProps) {
  const [state, dispatch] = useReducer(environmentReducer, undefined, initialEnvironmentState);
  const canSubmit = environmentFormValid(state.choices, scenarios) && state.phase === "editing";

  function handleSubmit() {
    if (!canSubmit) return;
    dispatch({ type: "submit_started" });
    submitEnvironment(state.choices as Record<EnvironmentScenarioKey, EnvironmentSide>, fetchImpl)
      .then(() => dispatch({ type: "submit_succeeded" }))
      .catch((err) => dispatch({ type: "submit_failed", error: err instanceof Error ? err.message : "failed" }));
  }

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  return (
    <div className="flex flex-col gap-4">
      {scenarios.map((scenario) => (
        <div key={scenario.key} className="flex flex-col gap-2 sm:flex-row">
          {(["a", "b"] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => dispatch({ type: "choice_made", key: scenario.key, side })}
              className={`flex-1 rounded-lg border p-3 text-left text-sm text-ink transition-colors ${
                state.choices[scenario.key] === side ? "border-amber" : "border-line hover:border-ink-muted"
              }`}
            >
              {side === "a" ? scenario.a : scenario.b}
            </button>
          ))}
        </div>
      ))}
      {state.error && <div className="text-sm text-danger">{state.error}</div>}
      <Button variant="primary" disabled={!canSubmit} busy={state.phase === "submitting"} onClick={handleSubmit}>
        Continue
      </Button>
    </div>
  );
}
