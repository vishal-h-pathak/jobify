"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { MetricClaim } from "@/lib/onboarding/moduleWriters/metrics";

export type MetricMarkValue = "confident" | "dont_use";

export interface MetricClaimRow extends MetricClaim {
  mark: MetricMarkValue | null;
}

export type MetricsPhase = "extracting" | "marking" | "submitting" | "error" | "finished";

export interface MetricsState {
  phase: MetricsPhase;
  rows: MetricClaimRow[];
  error: string | null;
  reloadToken: number;
}

export function initialMetricsState(): MetricsState {
  return { phase: "extracting", rows: [], error: null, reloadToken: 0 };
}

export type MetricsAction =
  | { type: "extract_retried" }
  | { type: "claims_loaded"; claims: MetricClaim[] }
  | { type: "extract_failed"; error: string }
  | { type: "mark_set"; id: string; mark: MetricMarkValue }
  | { type: "mark_all_confident" }
  | { type: "submit_started" }
  | { type: "submit_succeeded" }
  | { type: "submit_failed"; error: string };

export function metricsReducer(state: MetricsState, action: MetricsAction): MetricsState {
  switch (action.type) {
    case "extract_retried":
      return { ...state, phase: "extracting", rows: [], error: null, reloadToken: state.reloadToken + 1 };
    case "claims_loaded":
      return { ...state, phase: "marking", rows: action.claims.map((claim) => ({ ...claim, mark: null })), error: null };
    case "extract_failed":
      return { ...state, phase: "error", error: action.error };
    case "mark_set":
      return {
        ...state,
        rows: state.rows.map((row) => (row.id === action.id ? { ...row, mark: action.mark } : row)),
      };
    case "mark_all_confident":
      return { ...state, rows: state.rows.map((row) => ({ ...row, mark: "confident" as const })) };
    case "submit_started":
      return { ...state, phase: "submitting", error: null };
    case "submit_succeeded":
      return { ...state, phase: "finished" };
    case "submit_failed":
      // Back to "marking" (not "error") — the claims + marks the human
      // already made survive a failed POST, matching every other panel's
      // "don't lose the draft on failure" rule.
      return { ...state, phase: "marking", error: action.error };
    default:
      return state;
  }
}

/** Every row must carry an explicit mark before submit is reachable — an
 * empty `rows` array satisfies this vacuously, which is exactly the
 * zero-claims skip-ahead path (V3A-B2 task 6 brief). Nothing is ever
 * defaulted to confident. */
export function metricsCanSubmit(state: MetricsState): boolean {
  return state.phase === "marking" && state.rows.every((row) => row.mark !== null);
}

export function buildMarksPayload(rows: MetricClaimRow[]): { id: string; confident: boolean }[] {
  return rows.map((row) => ({ id: row.id, confident: row.mark === "confident" }));
}

export async function fetchMetricClaims(fetchImpl: typeof fetch): Promise<MetricClaim[]> {
  const res = await fetchImpl("/api/onboarding/modules/metrics/extract", { method: "POST" });
  if (!res.ok) throw new Error("failed to extract metric claims");
  const data = await res.json();
  return Array.isArray(data?.claims) ? data.claims : [];
}

export async function submitMetricMarks(
  rows: MetricClaimRow[],
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; key: string; receipt: string }> {
  const res = await fetchImpl("/api/onboarding/modules/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ marks: buildMarksPayload(rows) }),
  });
  if (!res.ok) throw new Error("failed to submit metric marks");
  return res.json();
}

const SOURCE_LABELS: Record<MetricClaim["source"], string> = {
  cv: "resume",
  range: "range",
  energy: "energy",
  anchor: "anchor",
};

function ClaimRow({
  row,
  disabled,
  onMark,
}: {
  row: MetricClaimRow;
  disabled: boolean;
  onMark: (mark: MetricMarkValue) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="text-lg leading-none text-amber">
          &ldquo;
        </span>
        <p className="text-ink">{row.text}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone="neutral">from your {SOURCE_LABELS[row.source]}</Badge>
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="mark this claim">
          <button
            type="button"
            aria-pressed={row.mark === "confident"}
            disabled={disabled}
            onClick={() => onMark("confident")}
            className={`px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              row.mark === "confident" ? "bg-amber text-base" : "text-ink-muted hover:text-ink"
            }`}
          >
            Confident
          </button>
          <button
            type="button"
            aria-pressed={row.mark === "dont_use"}
            disabled={disabled}
            onClick={() => onMark("dont_use")}
            className={`border-l border-line px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              row.mark === "dont_use" ? "bg-danger/15 text-danger" : "text-ink-muted hover:text-ink"
            }`}
          >
            Don&apos;t use
          </button>
        </div>
      </div>
    </div>
  );
}

export interface MetricsMarkingViewProps {
  rows: MetricClaimRow[];
  canSubmit: boolean;
  submitting: boolean;
  error: string | null;
  onMark: (id: string, mark: MetricMarkValue) => void;
  onMarkAllConfident: () => void;
  onSubmit: () => void;
}

/** Stateless — the marking UI as a pure function of props, so the
 * disabled-until-every-row-marked contract is directly testable without a
 * DOM (this repo's vitest config runs in `node`, no jsdom). */
export function MetricsMarkingView({
  rows,
  canSubmit,
  submitting,
  error,
  onMark,
  onMarkAllConfident,
  onSubmit,
}: MetricsMarkingViewProps) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">Nothing to mark — moving on.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button variant="primary" busy={submitting} disabled={submitting} onClick={onSubmit}>
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-muted">
          Every number we found. Anything you don&apos;t mark Confident will never appear in a resume or cover letter we
          write. This is the fence.
        </p>
        <Button variant="ghost" disabled={submitting} onClick={onMarkAllConfident}>
          mark all confident
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <ClaimRow key={row.id} row={row} disabled={submitting} onMark={(mark) => onMark(row.id, mark)} />
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <Button variant="primary" busy={submitting} disabled={submitting || !canSubmit} onClick={onSubmit}>
        Continue
      </Button>
    </div>
  );
}

export interface MetricsPanelProps {
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

/** V3A_DESIGN.md §2.2 — pre-marking extraction (1 LLM turn) then a zero-LLM
 * marking POST. Submit stays disabled until every extracted claim carries an
 * explicit mark; a zero-claims extraction still routes through the same
 * submit path with `marks: []`. */
export function MetricsPanel({ onComplete, fetchImpl = fetch }: MetricsPanelProps) {
  const [state, dispatch] = useReducer(metricsReducer, undefined, initialMetricsState);

  useEffect(() => {
    let cancelled = false;
    fetchMetricClaims(fetchImpl)
      .then((claims) => {
        if (!cancelled) dispatch({ type: "claims_loaded", claims });
      })
      .catch((err) => {
        if (!cancelled) dispatch({ type: "extract_failed", error: err instanceof Error ? err.message : "failed" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reloadToken]);

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  function handleSubmit() {
    if (!metricsCanSubmit(state)) return;
    dispatch({ type: "submit_started" });
    submitMetricMarks(state.rows, fetchImpl)
      .then(() => dispatch({ type: "submit_succeeded" }))
      .catch((err) => dispatch({ type: "submit_failed", error: err instanceof Error ? err.message : "failed" }));
  }

  if (state.phase === "extracting") {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Reading your resume and answers…
      </p>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-danger">{state.error}</p>
        <Button variant="secondary" onClick={() => dispatch({ type: "extract_retried" })}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <MetricsMarkingView
      rows={state.rows}
      canSubmit={metricsCanSubmit(state)}
      submitting={state.phase === "submitting"}
      error={state.error}
      onMark={(id, mark) => dispatch({ type: "mark_set", id, mark })}
      onMarkAllConfident={() => dispatch({ type: "mark_all_confident" })}
      onSubmit={handleSubmit}
    />
  );
}
