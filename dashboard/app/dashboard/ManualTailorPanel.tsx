"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn, btnLinkClass } from "./components/Button";
import { useToast } from "./components/Toast";

/**
 * ManualTailorPanel — paste a posting URL, get a tailored row.
 *
 * The form POSTs to /api/dashboard/runs/tailor-manual which inserts a
 * runs row (kind='tailor_manual') and dispatches tailor-manual.yml. The
 * panel then polls /api/dashboard/runs?limit=50, locates its run by id,
 * and surfaces the back-channel result jsonb the CLI writes:
 *
 *   { job_id, status, confidence, title, company,
 *     review_url | materials_url }
 *
 * High-confidence flow ends with a "Review materials" button that opens
 * /dashboard/review/{job_id}. Low-confidence flow (Amendment 1) ends
 * with a "Verify in review" button to the same page — the existing
 * review surface is the verification surface for both confidence tiers.
 *
 * Mounted on /dashboard between the header and RunsPanel so the paste-
 * a-URL affordance lives next to the bulk pipeline-runs controls.
 */

type RunStatus = "pending" | "running" | "completed" | "failed";

type ResultPayload = {
  job_id?: string;
  status?: string;
  confidence?: "high" | "low";
  title?: string;
  company?: string | null;
  review_url?: string | null;
  materials_url?: string | null;
};

type Run = {
  id: string;
  kind: "hunt" | "tailor" | "tailor_manual";
  status: RunStatus;
  result: ResultPayload | null;
  failure_reason: string | null;
  github_run_url: string | null;
  created_at: string;
  started_at: string | null;
};

const POLL_INTERVAL_MS = 5000;

function isTerminal(s: RunStatus): boolean {
  return s === "completed" || s === "failed";
}

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ManualTailorPanel() {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const toast = useToast();

  const trimmedUrl = url.trim();
  const canSubmit = !submitting && !runId && looksLikeUrl(trimmedUrl);

  const fetchRun = useCallback(async (id: string): Promise<Run | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/dashboard/runs?limit=50`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { runs?: Run[] };
      return json.runs?.find((r) => r.id === id) ?? null;
    } catch {
      return null;
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Poll the runs list for our specific row until it terminates.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      const next = await fetchRun(runId);
      if (cancelled || !next) return;
      setRun(next);
    };
    tick();
    const t = window.setInterval(() => {
      if (run && isTerminal(run.status)) return;
      tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [runId, run, fetchRun]);

  const dispatch = async (target: string) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/dashboard/runs/tailor-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        run_id?: string;
        error?: string;
      };
      if (res.ok && json.run_id) {
        setRunId(json.run_id);
        setRun(null);
      } else {
        const msg = json.error ?? `Failed to dispatch (${res.status})`;
        setSubmitError(msg);
        toast.push("error", `Manual tailor dispatch failed — ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
      toast.push("error", `Manual tailor dispatch failed — ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    await dispatch(trimmedUrl);
  };

  // Re-dispatch the same URL after a failed run. The url input state
  // survives the whole run lifecycle (reset() is the only thing that
  // clears it), so the failed run's target is still in `url`.
  const retry = async () => {
    if (submitting || !looksLikeUrl(trimmedUrl)) return;
    setRunId(null);
    setRun(null);
    await dispatch(trimmedUrl);
  };

  const reset = () => {
    setUrl("");
    setRunId(null);
    setRun(null);
    setSubmitError(null);
  };

  const statusLabel = useMemo(() => {
    if (!run) return runId ? "queued — waiting for GHA…" : null;
    switch (run.status) {
      case "pending":
        return "queued — waiting for GHA…";
      case "running":
        return "scraping + tailoring…";
      case "completed":
      case "failed":
        return null; // rendered as result / failure panel instead
    }
  }, [run, runId]);

  return (
    <section
      aria-label="Manual job-URL tailor"
      className="mb-6 border border-rule bg-bg-raised p-3.5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          Paste a posting URL
        </h2>
        {runId && (
          <Btn variant="ghost" onClick={reset}>
            ← submit another
          </Btn>
        )}
      </div>

      {!runId && (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <label htmlFor="manual-tailor-url" className="sr-only">
            Posting URL
          </label>
          <input
            id="manual-tailor-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://jobs.lever.co/company/posting-id"
            className="min-w-[260px] flex-1 border border-rule bg-bg px-3 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
            aria-invalid={!!submitError}
            aria-describedby={submitError ? "manual-tailor-error" : undefined}
          />
          <Btn
            type="submit"
            variant="primary"
            pending={submitting}
            disabled={!canSubmit}
          >
            tailor this url
          </Btn>
        </form>
      )}

      {submitError && (
        <p
          id="manual-tailor-error"
          role="alert"
          className="mt-2 text-[11px] text-red"
        >
          {submitError}
          {looksLikeUrl(trimmedUrl) && !submitting && (
            <button
              type="button"
              onClick={() => void retry()}
              className="ml-2 text-red underline underline-offset-2 transition-colors duration-150 hover:text-ink"
            >
              retry
            </button>
          )}
        </p>
      )}

      {statusLabel && (
        <p
          aria-live="polite"
          className="mt-3 flex items-center gap-2 text-[11px] text-green"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-green motion-safe:animate-pulse"
          />
          {statusLabel}
          {run?.github_run_url && (
            <a
              href={run.github_run_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-ink-faint underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
            >
              GHA →
            </a>
          )}
        </p>
      )}

      {run && run.status === "completed" && run.result?.job_id && (
        <ResultCard result={run.result} />
      )}

      {run && run.status === "failed" && (
        <div role="alert" className="mt-3 border border-red-dim px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-red">
            Tailor failed
          </div>
          <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-dim">
            {run.failure_reason ?? "Unknown error. Check the GHA log."}
          </p>
          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void retry()}
              disabled={submitting || !looksLikeUrl(trimmedUrl)}
              className="text-[11px] text-red underline underline-offset-2 transition-colors duration-150 hover:text-ink disabled:opacity-50"
            >
              {submitting ? "retrying…" : "retry this url"}
            </button>
            {run.github_run_url && (
              <a
                href={run.github_run_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-ink-faint underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
              >
                view GHA run →
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ResultCard({ result }: { result: ResultPayload }) {
  const isLow = result.confidence === "low";
  const linkHref =
    result.materials_url ?? result.review_url ?? `/dashboard/review/${result.job_id}`;

  return (
    <div className="mt-3 border border-rule bg-bg px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={`mb-1 text-[10px] uppercase tracking-[0.18em] ${
              isLow ? "text-amber" : "text-green"
            }`}
          >
            {isLow ? "Low confidence — verify before tailoring" : "Tailored"}
          </div>
          <p className="truncate text-xs font-medium text-ink">
            {result.title ?? "(no title)"}
          </p>
          <p className="truncate text-[11px] text-ink-dim">
            {result.company ?? "(unknown company)"}
            {result.job_id && (
              <span className="ml-2 text-ink-faint tabular-nums">
                {result.job_id}
              </span>
            )}
          </p>
        </div>
        <Link
          href={linkHref}
          className={btnLinkClass(isLow ? "primary" : "approve")}
        >
          {isLow ? "verify in review" : "review materials"}
        </Link>
      </div>
    </div>
  );
}
