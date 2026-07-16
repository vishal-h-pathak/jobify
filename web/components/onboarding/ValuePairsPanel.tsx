"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/Button";

export interface ValuePairDef {
  pair_id: string;
  a: string;
  b: string;
}

export type ValueSide = "a" | "b";

export interface ValueChoice {
  pair_id: string;
  choice: ValueSide;
}

export const VALUE_PAIRS_MIN_ANSWERS = 6;
export const VALUE_PAIRS_FLASH_MS = 150;
export const VALUE_PAIRS_ADVANCE_MS = 200;
export const VALUE_PAIRS_FRAME_COPY = "Same pay either way.";

type Phase = "choosing" | "flashing" | "submitting" | "error" | "finished";

export interface ValuePairsState {
  index: number;
  choices: ValueChoice[];
  skipUsed: boolean;
  flashing: ValueSide | null;
  phase: Phase;
  error: string | null;
}

export function initialValuePairsState(): ValuePairsState {
  return { index: 0, choices: [], skipUsed: false, flashing: null, phase: "choosing", error: null };
}

export type ValuePairsAction =
  | { type: "choice_made"; pairId: string; choice: ValueSide }
  | { type: "flash_settled" }
  | { type: "skip_pressed" }
  | { type: "submit_started" }
  | { type: "submit_succeeded" }
  | { type: "submit_failed"; error: string };

export function valuePairsReducer(state: ValuePairsState, action: ValuePairsAction, totalPairs: number): ValuePairsState {
  switch (action.type) {
    case "choice_made":
      if (state.phase !== "choosing") return state;
      return {
        ...state,
        phase: "flashing",
        flashing: action.choice,
        choices: [...state.choices, { pair_id: action.pairId, choice: action.choice }],
      };
    case "flash_settled": {
      const nextIndex = state.index + 1;
      if (nextIndex >= totalPairs) return { ...state, index: nextIndex, flashing: null, phase: "submitting" };
      return { ...state, index: nextIndex, flashing: null, phase: "choosing" };
    }
    case "skip_pressed": {
      if (state.skipUsed || state.phase !== "choosing") return state;
      const nextIndex = state.index + 1;
      if (nextIndex >= totalPairs) return { ...state, index: nextIndex, skipUsed: true, phase: "submitting" };
      return { ...state, index: nextIndex, skipUsed: true, phase: "choosing" };
    }
    case "submit_started":
      return { ...state, phase: "submitting", error: null };
    case "submit_succeeded":
      return { ...state, phase: "finished" };
    case "submit_failed":
      return { ...state, phase: "error", error: action.error };
    default:
      return state;
  }
}

export async function submitValuePairs(
  choices: ValueChoice[],
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; key: string; receipt: string }> {
  const res = await fetchImpl("/api/onboarding/modules/values", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(choices),
  });
  if (!res.ok) throw new Error("failed to submit values");
  return res.json();
}

export interface ValuePairCardsViewProps {
  pair: ValuePairDef;
  flashing: ValueSide | null;
  skipAvailable: boolean;
  onChoose: (choice: ValueSide) => void;
  onSkip: () => void;
}

/** One pair per screen — two option cards, tap to choose, no Likert, no sliders. */
export function ValuePairCardsView({ pair, flashing, skipAvailable, onChoose, onSkip }: ValuePairCardsViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{VALUE_PAIRS_FRAME_COPY}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {(["a", "b"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => onChoose(side)}
            className={`flex-1 rounded-lg border p-4 text-left text-lg text-ink transition-colors duration-150 ${
              flashing === side ? "border-amber" : "border-line hover:border-ink-muted"
            }`}
          >
            {side === "a" ? pair.a : pair.b}
          </button>
        ))}
      </div>
      {skipAvailable && (
        <Button variant="ghost" onClick={onSkip} className="self-start">
          Can&apos;t choose — skip
        </Button>
      )}
    </div>
  );
}

export interface ValuePairsPanelProps {
  valuePairs: ValuePairDef[];
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

/**
 * V3A_DESIGN.md §1.4 — 7 forced pairs, one screen at a time. Choices are
 * collected locally and submitted as one array once the deck is exhausted
 * (the module route replaces `extracted.values` wholesale, so there's no
 * value in POSTing per-pair).
 */
export function ValuePairsPanel({ valuePairs, onComplete, fetchImpl = fetch }: ValuePairsPanelProps) {
  const [state, dispatch] = useReducer(
    (s: ValuePairsState, a: ValuePairsAction) => valuePairsReducer(s, a, valuePairs.length),
    undefined,
    initialValuePairsState
  );

  useEffect(() => {
    if (state.phase !== "flashing") return undefined;
    const timer = setTimeout(() => dispatch({ type: "flash_settled" }), VALUE_PAIRS_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "submitting") return;
    if (state.choices.length < VALUE_PAIRS_MIN_ANSWERS) {
      // Should be unreachable in the guided flow (skip usable once, 7 pairs
      // total -> at least 6 answered), but never silently submit short.
      dispatch({ type: "submit_failed", error: `only ${state.choices.length} of ${VALUE_PAIRS_MIN_ANSWERS} required trade-offs answered` });
      return;
    }
    submitValuePairs(state.choices, fetchImpl)
      .then(() => dispatch({ type: "submit_succeeded" }))
      .catch((err) => dispatch({ type: "submit_failed", error: err instanceof Error ? err.message : "failed" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  if (state.phase === "error") return <div className="text-sm text-danger">{state.error}</div>;
  if (state.phase === "submitting" || state.phase === "finished") {
    return <div className="text-sm text-ink-muted">Saving your trade-offs…</div>;
  }

  const pair = valuePairs[state.index];
  if (!pair) return null;

  return (
    <ValuePairCardsView
      pair={pair}
      flashing={state.flashing}
      skipAvailable={!state.skipUsed}
      onChoose={(choice) => dispatch({ type: "choice_made", pairId: pair.pair_id, choice })}
      onSkip={() => dispatch({ type: "skip_pressed" })}
    />
  );
}
