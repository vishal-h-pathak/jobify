"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Btn } from "./components/Button";
import { RunStatusBadge } from "./components/JobBadges";
import { SkeletonRows } from "./components/Skeleton";
import { useToast } from "./components/Toast";
import { relativeTime } from "./lib/format";

/**
 * RunsPanel — pipeline-run dispatch + recent runs ledger.
 *
 * Reads/writes go through:
 *   GET  /api/dashboard/runs?limit=10
 *   POST /api/dashboard/runs/hunt | /tailor | /tailor-manual
 *
 * Refresh strategy (the v2 responsiveness contract):
 *   - dispatches insert an optimistic row immediately (replaced by the
 *     real row id on the server ack, converged by the next poll)
 *   - after any dispatch the poll tightens to 5s for 30s so state
 *     converges fast, then backs off to 15s while runs are active
 *   - idle (no active rows) → no polling at all
 *   - dispatch failures toast AND mark the optimistic row failed
 *
 * "Run submit" is intentionally absent — visible-browser pre-fill needs
 * a human at the keyboard, so the per-row "Pre-fill" button at
 * /dashboard/review/[job_id] remains the only entry to the submit phase.
 *
 * Dismissed-run ids are stored device-locally in localStorage so a
 * stale completed/failed row stays out of the user's sight on this
 * browser. This is INTENTIONALLY not synced across devices — runs are
 * an ephemeral operational signal, not a user setting. Don't "fix"
 * this by persisting to Supabase.
 */

type RunKind = "hunt" | "tailor" | "tailor_manual";
type RunStatus = "pending" | "running" | "completed" | "failed";

type Run = {
  id: string;
  kind: RunKind;
  status: RunStatus;
  triggered_by: string;
  args: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string | null;
  log_excerpt: string | null;
  failure_reason: string | null;
  github_run_url: string | null;
  result: {
    job_id?: string;
    status?: string;
    confidence?: "high" | "low";
    title?: string;
    company?: string | null;
    review_url?: string | null;
    materials_url?: string | null;
  } | null;
  created_at: string;
};

const POLL_BASE_MS = 15_000;
const POLL_BOOST_MS = 5_000;
const BOOST_WINDOW_MS = 30_000;
const LIST_LIMIT = 10;

// kind → dispatch endpoint. Not string-interpolated from kind because
// 'tailor_manual' (DB enum, underscore) maps to /runs/tailor-manual
// (route segment, hyphen).
const RUN_ENDPOINT: Record<RunKind, string> = {
  hunt: "/api/dashboard/runs/hunt",
  tailor: "/api/dashboard/runs/tailor",
  tailor_manual: "/api/dashboard/runs/tailor-manual",
};

const DISMISSED_LS_KEY = "dashboard:runs:dismissed";

function isActive(r: Run): boolean {
  return r.status === "pending" || r.status === "running";
}

function isOptimisticId(id: string): boolean {
  return id.startsWith("optimistic-");
}

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveDismissed(s: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSED_LS_KEY, JSON.stringify([...s]));
  } catch {
    // localStorage can be full or disabled — the user can re-dismiss.
  }
}

export default function RunsPanel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const boostUntil = useRef(0);
  const [pollEpoch, setPollEpoch] = useState(0);
  const toast = useToast();

  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/dashboard/runs?limit=${LIST_LIMIT}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { runs?: Run[] };
      const serverRuns = json.runs ?? [];
      setRuns((prev) => {
        const optimistic = prev.filter((r) => isOptimisticId(r.id));
        return [...optimistic, ...serverRuns];
      });
    } catch {
      // Poll failures are transient; the next tick retries.
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleRuns = useMemo(
    () => runs.filter((r) => !dismissed.has(r.id)),
    [runs, dismissed],
  );
  const hasActive = useMemo(() => visibleRuns.some(isActive), [visibleRuns]);

  // Conditional polling: 5s inside the post-dispatch boost window, 15s
  // while anything is active, off otherwise. pollEpoch retriggers the
  // effect when a dispatch opens a boost window.
  useEffect(() => {
    const boosted = Date.now() < boostUntil.current;
    if (!hasActive && !boosted) return;
    const interval = boosted ? POLL_BOOST_MS : POLL_BASE_MS;
    const t = window.setInterval(() => {
      void refresh();
      // Fall out of the boost cadence once the window closes.
      if (boostUntil.current !== 0 && Date.now() >= boostUntil.current) {
        boostUntil.current = 0;
        setPollEpoch((n) => n + 1);
      }
    }, interval);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive, pollEpoch]);

  const dispatchRun = async (
    kind: RunKind,
    args?: Record<string, unknown> | null,
  ) => {
    const tempId = `optimistic-${kind}-${Date.now()}`;
    const optimistic: Run = {
      id: tempId,
      kind,
      status: "pending",
      triggered_by: "dashboard",
      args: args ?? null,
      started_at: null,
      ended_at: null,
      log_excerpt: null,
      failure_reason: null,
      github_run_url: null,
      result: null,
      created_at: new Date().toISOString(),
    };
    setRuns((prev) => [optimistic, ...prev]);
    boostUntil.current = Date.now() + BOOST_WINDOW_MS;
    setPollEpoch((n) => n + 1);

    try {
      const res = await fetch(RUN_ENDPOINT[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args ?? {}),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        run_id?: string;
        error?: string;
      };
      if (res.ok && json.run_id) {
        setRuns((prev) =>
          prev.map((r) =>
            r.id === tempId ? { ...r, id: json.run_id as string } : r,
          ),
        );
      } else {
        const reason =
          json.error ?? `Failed to dispatch ${kind} (${res.status})`;
        setRuns((prev) =>
          prev.map((r) =>
            r.id === tempId
              ? {
                  ...r,
                  status: "failed",
                  failure_reason: reason,
                  ended_at: new Date().toISOString(),
                }
              : r,
          ),
        );
        toast.push("error", `${kind} dispatch failed — ${reason}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRuns((prev) =>
        prev.map((r) =>
          r.id === tempId
            ? {
                ...r,
                status: "failed",
                failure_reason: msg,
                ended_at: new Date().toISOString(),
              }
            : r,
        ),
      );
      toast.push("error", `${kind} dispatch failed — ${msg}`);
    }
  };

  // Re-dispatch a failed run with its original args. Optimistic failed
  // rows (dispatch never reached the server) are removed from local
  // state; server rows stay as history and can be dismissed by hand.
  const retryRun = (r: Run) => {
    if (isOptimisticId(r.id)) {
      setRuns((prev) => prev.filter((x) => x.id !== r.id));
    }
    void dispatchRun(r.kind, r.args);
  };

  const dismissRow = (id: string) => {
    if (isOptimisticId(id)) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  };

  const clearCompleted = () => {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const r of visibleRuns) {
        if (r.status === "completed" || r.status === "failed") {
          if (!isOptimisticId(r.id)) next.add(r.id);
        }
      }
      saveDismissed(next);
      return next;
    });
  };

  const huntBusy = visibleRuns.some((r) => r.kind === "hunt" && isActive(r));
  const tailorBusy = visibleRuns.some(
    (r) => r.kind === "tailor" && isActive(r),
  );
  const hasDismissibleCompleted = visibleRuns.some(
    (r) =>
      (r.status === "completed" || r.status === "failed") &&
      !isOptimisticId(r.id),
  );

  return (
    <section className="mb-6 border border-rule bg-bg-raised p-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          Pipeline runs
        </h2>
        <div className="flex items-center gap-1.5">
          {hasDismissibleCompleted && (
            <Btn
              variant="ghost"
              onClick={clearCompleted}
              aria-label="Clear completed runs from this device"
            >
              clear completed
            </Btn>
          )}
          <Btn
            variant="secondary"
            onClick={() => void dispatchRun("hunt")}
            pending={huntBusy}
            disabled={huntBusy}
          >
            run hunt
          </Btn>
          <Btn
            variant="secondary"
            onClick={() => void dispatchRun("tailor")}
            pending={tailorBusy}
            disabled={tailorBusy}
            title="Bulk action — tailors every row in 'approved'. The per-row Tailor button on each card is the common case."
          >
            tailor all approved
          </Btn>
        </div>
      </div>

      {!loaded ? (
        <SkeletonRows rows={3} rowClassName="h-7" />
      ) : visibleRuns.length === 0 ? (
        <p className="text-[11px] text-ink-faint">
          {runs.length === 0
            ? "No runs yet — run hunt to start."
            : "All runs cleared from this view."}
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-rule-soft overflow-y-auto text-xs">
          {visibleRuns.map((r) => {
            const expanded = expandedId === r.id;
            const canExpand = !!(r.failure_reason || r.log_excerpt);
            const isDismissible = !isOptimisticId(r.id);
            const timeIso =
              r.status === "running" && r.started_at
                ? r.started_at
                : r.created_at;
            const timeLabel =
              r.status === "running" && r.started_at
                ? `started ${relativeTime(timeIso)}`
                : relativeTime(timeIso);

            return (
              <li key={r.id} className="py-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">
                      {r.kind}
                    </span>
                    <RunStatusBadge status={r.status} />
                    {r.failure_reason && !expanded && (
                      <span
                        className="truncate text-[10px] text-red"
                        title={r.failure_reason}
                      >
                        {r.failure_reason}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-faint">
                    {r.status === "failed" && (
                      <Btn
                        variant="ghost"
                        onClick={() => retryRun(r)}
                        aria-label={`Retry failed ${r.kind} run`}
                      >
                        retry
                      </Btn>
                    )}
                    <span className="tabular-nums">{timeLabel}</span>
                    {r.github_run_url ? (
                      <a
                        href={r.github_run_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-dim underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
                      >
                        GHA →
                      </a>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                    {canExpand && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId((prev) => (prev === r.id ? null : r.id))
                        }
                        aria-expanded={expanded}
                        aria-label={
                          expanded ? "Collapse run details" : "Expand run details"
                        }
                        className="px-1 text-ink-faint transition-colors duration-150 hover:text-ink"
                      >
                        {expanded ? "▴" : "▾"}
                      </button>
                    )}
                    {isDismissible && (
                      <button
                        type="button"
                        onClick={() => dismissRow(r.id)}
                        aria-label="Dismiss this run"
                        title="Dismiss (device-local)"
                        className="px-1 text-ink-faint transition-colors duration-150 hover:text-ink"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {expanded && canExpand && (
                  <div className="ml-16 mr-2 mt-2 space-y-2">
                    {r.failure_reason && (
                      <div className="border border-red-dim px-3 py-2">
                        <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-red">
                          Failure reason
                        </div>
                        <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-dim">
                          {r.failure_reason}
                        </p>
                      </div>
                    )}
                    {r.log_excerpt && (
                      <div className="border border-rule bg-bg px-3 py-2">
                        <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                          Log excerpt
                        </div>
                        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-dim">
                          {r.log_excerpt}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
