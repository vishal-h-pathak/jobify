"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type SimpleChipId = "onsite_required" | "defense" | "crypto_gambling";

interface SimpleChipDef {
  id: SimpleChipId;
  label: string;
  value: string;
}

/** V3A_DESIGN.md §1.5 — canned hard-filter chips (comp + city are special-cased below). */
export const SIMPLE_CHIPS: SimpleChipDef[] = [
  { id: "onsite_required", label: "On-site required", value: "on-site required" },
  { id: "defense", label: "Defense", value: "defense" },
  { id: "crypto_gambling", label: "Crypto / gambling", value: "crypto/gambling" },
];

export interface DealbreakersState {
  activeSimple: SimpleChipId[];
  compActive: boolean;
  compValue: string;
  cityActive: boolean;
  cityValue: string;
  freeAdd: string[];
  freeAddDraft: string;
  softConcerns: string[];
  softConcernDraft: string;
  phase: "editing" | "submitting" | "error" | "finished";
  error: string | null;
}

export function initialDealbreakersState(): DealbreakersState {
  return {
    activeSimple: [],
    compActive: false,
    compValue: "",
    cityActive: false,
    cityValue: "",
    freeAdd: [],
    freeAddDraft: "",
    softConcerns: [],
    softConcernDraft: "",
    phase: "editing",
    error: null,
  };
}

export type DealbreakersAction =
  | { type: "simple_toggled"; id: SimpleChipId }
  | { type: "comp_toggled" }
  | { type: "comp_value_changed"; value: string }
  | { type: "city_toggled" }
  | { type: "city_value_changed"; value: string }
  | { type: "free_add_draft_changed"; value: string }
  | { type: "free_add_committed" }
  | { type: "free_add_removed"; value: string }
  | { type: "soft_concern_draft_changed"; value: string }
  | { type: "soft_concern_committed" }
  | { type: "soft_concern_removed"; value: string }
  | { type: "submit_started" }
  | { type: "submit_succeeded" }
  | { type: "submit_failed"; error: string };

export function dealbreakersReducer(state: DealbreakersState, action: DealbreakersAction): DealbreakersState {
  switch (action.type) {
    case "simple_toggled":
      return {
        ...state,
        activeSimple: state.activeSimple.includes(action.id)
          ? state.activeSimple.filter((id) => id !== action.id)
          : [...state.activeSimple, action.id],
      };
    case "comp_toggled":
      return { ...state, compActive: !state.compActive, compValue: state.compActive ? "" : state.compValue };
    case "comp_value_changed":
      return { ...state, compValue: action.value };
    case "city_toggled":
      return { ...state, cityActive: !state.cityActive, cityValue: state.cityActive ? "" : state.cityValue };
    case "city_value_changed":
      return { ...state, cityValue: action.value };
    case "free_add_draft_changed":
      return { ...state, freeAddDraft: action.value };
    case "free_add_committed": {
      const value = state.freeAddDraft.trim();
      if (!value || state.freeAdd.includes(value)) return { ...state, freeAddDraft: "" };
      return { ...state, freeAdd: [...state.freeAdd, value], freeAddDraft: "" };
    }
    case "free_add_removed":
      return { ...state, freeAdd: state.freeAdd.filter((v) => v !== action.value) };
    case "soft_concern_draft_changed":
      return { ...state, softConcernDraft: action.value };
    case "soft_concern_committed": {
      const value = state.softConcernDraft.trim();
      if (!value || state.softConcerns.includes(value)) return { ...state, softConcernDraft: "" };
      return { ...state, softConcerns: [...state.softConcerns, value], softConcernDraft: "" };
    }
    case "soft_concern_removed":
      return { ...state, softConcerns: state.softConcerns.filter((v) => v !== action.value) };
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

/**
 * comp/city are the two "opens a field, serializes to a sentence" chips
 * (V3A_DESIGN.md §1.5). City's exact wording isn't specced beyond "serializes
 * to a disqualifier string" for comp — "only {city}" is this session's
 * reading of the equivalent for "specific-city-only".
 */
export function buildHardDisqualifiers(state: DealbreakersState): string[] {
  const values: string[] = [];
  for (const chip of SIMPLE_CHIPS) {
    if (state.activeSimple.includes(chip.id)) values.push(chip.value);
  }
  if (state.compActive && state.compValue.trim()) values.push(`comp below $${state.compValue.trim()}`);
  if (state.cityActive && state.cityValue.trim()) values.push(`only ${state.cityValue.trim()}`);
  return [...values, ...state.freeAdd];
}

export async function submitDealbreakers(
  hardDisqualifiers: string[],
  softConcerns: string[],
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; key: string; receipt: string }> {
  const res = await fetchImpl("/api/onboarding/modules/dealbreakers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hard_disqualifiers: hardDisqualifiers, soft_concerns: softConcerns }),
  });
  if (!res.ok) throw new Error("failed to submit dealbreakers");
  return res.json();
}

export interface DealbreakersPanelProps {
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

/**
 * V3A_DESIGN.md §1.5 — the dealbreakers module (submitting it fires the
 * phase-1 checkpoint server-side, see checkpoint.ts / the module route's
 * always-call-maybeFireCheckpoint contract).
 */
export function DealbreakersPanel({ onComplete, fetchImpl = fetch }: DealbreakersPanelProps) {
  const [state, dispatch] = useReducer(dealbreakersReducer, undefined, initialDealbreakersState);

  const hardDisqualifiers = buildHardDisqualifiers(state);
  const canSubmit = hardDisqualifiers.length > 0 && state.phase === "editing";

  function handleSubmit() {
    if (!canSubmit) return;
    dispatch({ type: "submit_started" });
    submitDealbreakers(hardDisqualifiers, state.softConcerns, fetchImpl)
      .then(() => dispatch({ type: "submit_succeeded" }))
      .catch((err) => dispatch({ type: "submit_failed", error: err instanceof Error ? err.message : "failed" }));
  }

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {SIMPLE_CHIPS.map((chip) => (
          <ChipToggle
            key={chip.id}
            label={chip.label}
            active={state.activeSimple.includes(chip.id)}
            onToggle={() => dispatch({ type: "simple_toggled", id: chip.id })}
          />
        ))}
        <ChipToggle label="Comp below $" active={state.compActive} onToggle={() => dispatch({ type: "comp_toggled" })} />
        <ChipToggle
          label="Specific city only"
          active={state.cityActive}
          onToggle={() => dispatch({ type: "city_toggled" })}
        />
      </div>
      {state.compActive && (
        <Input
          type="number"
          placeholder="e.g. 120000"
          value={state.compValue}
          onChange={(e) => dispatch({ type: "comp_value_changed", value: e.target.value })}
        />
      )}
      {state.cityActive && (
        <Input
          type="text"
          placeholder="e.g. Atlanta"
          value={state.cityValue}
          onChange={(e) => dispatch({ type: "city_value_changed", value: e.target.value })}
        />
      )}
      <TagListEditor
        label="Anything else that's a hard no"
        values={state.freeAdd}
        draft={state.freeAddDraft}
        onDraftChange={(value) => dispatch({ type: "free_add_draft_changed", value })}
        onCommit={() => dispatch({ type: "free_add_committed" })}
        onRemove={(value) => dispatch({ type: "free_add_removed", value })}
      />
      <TagListEditor
        label="Soft concerns (not dealbreakers, just noted)"
        muted
        values={state.softConcerns}
        draft={state.softConcernDraft}
        onDraftChange={(value) => dispatch({ type: "soft_concern_draft_changed", value })}
        onCommit={() => dispatch({ type: "soft_concern_committed" })}
        onRemove={(value) => dispatch({ type: "soft_concern_removed", value })}
      />
      {state.error && <div className="text-sm text-danger">{state.error}</div>}
      <Button variant="primary" disabled={!canSubmit} busy={state.phase === "submitting"} onClick={handleSubmit}>
        Continue
      </Button>
    </div>
  );
}

function ChipToggle({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active ? "border-amber bg-amber/10 text-ink" : "border-line text-ink-muted hover:border-ink-muted"
      }`}
    >
      {label}
    </button>
  );
}

function TagListEditor({
  label,
  values,
  draft,
  muted,
  onDraftChange,
  onCommit,
  onRemove,
}: {
  label: string;
  values: string[];
  draft: string;
  muted?: boolean;
  onDraftChange: (value: string) => void;
  onCommit: () => void;
  onRemove: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={`text-xs ${muted ? "text-ink-muted" : "text-ink"}`}>{label}</span>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className={`flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs ${
              muted ? "text-ink-muted" : "text-ink"
            }`}
          >
            {value}
            <button type="button" onClick={() => onRemove(value)} aria-label={`remove ${value}`} className="text-ink-muted hover:text-danger">
              ×
            </button>
          </span>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
        placeholder="type and press enter"
      />
    </div>
  );
}
