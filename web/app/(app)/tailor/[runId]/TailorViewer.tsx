"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TAILOR_STAGES } from "@/components/tailor/types";
import { interpretTailorResponse } from "@/app/(app)/feed/tailorOutcome";
import type { PolledTailorRun } from "@/lib/tailor/pollRuns";

const POLL_INTERVAL_MS = 4000;

export interface StageStatus {
  step: string;
  label: string;
  state: "done" | "current" | "pending";
  at?: string;
}

/**
 * Maps a run's `progress[]` (worker-appended, in step order) onto the fixed
 * 6-stage checklist. No fake percent bar (design §3.2) — a step is "done"
 * once it has a progress entry, "current" is the first one without an
 * entry yet, everything after that is "pending".
 */
export function deriveStages(progress: Array<{ step: string; label: string; at: string }>): StageStatus[] {
  const seen = new Map(progress.map((p) => [p.step, p]));
  let currentAssigned = false;
  return TAILOR_STAGES.map(({ step, label }) => {
    const entry = seen.get(step);
    if (entry) return { step, label, state: "done" as const, at: entry.at };
    if (!currentAssigned) {
      currentAssigned = true;
      return { step, label, state: "current" as const };
    }
    return { step, label, state: "pending" as const };
  });
}

function GeneratingPanel({ run }: { run: PolledTailorRun }) {
  const stages = deriveStages(run.progress);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">Tailoring your materials — this takes a couple of minutes. Feel free to leave; it'll be here when you're back.</p>
      <ul className="flex flex-col gap-2">
        {stages.map((stage) => (
          <li key={stage.step} className="flex items-center gap-2 text-sm">
            {stage.state === "current" && <Spinner className="h-3.5 w-3.5" />}
            <span
              className={
                stage.state === "done" ? "text-ink" : stage.state === "current" ? "font-medium text-ink" : "text-ink-muted"
              }
            >
              {stage.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FailedPanel({ run, postingId, onRetried }: { run: PolledTailorRun; postingId: string; onRetried: (runId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/tailor/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posting_id: postingId, mode: "tailor" }),
    });
    const body = await res.json();
    const outcome = interpretTailorResponse(res.status, body);
    setBusy(false);
    if (outcome.kind === "started") {
      onRetried(outcome.runId);
      return;
    }
    setMessage(outcome.message);
  }

  return (
    <Banner tone="danger" className="flex flex-col gap-2">
      <p>{run.error ?? "This tailor run failed."}</p>
      <Button variant="secondary" busy={busy} onClick={retry}>
        Try again
      </Button>
      {message && <p className="text-xs text-ink-muted">{message}</p>}
    </Banner>
  );
}

export function TailorViewer({ runId, postingId }: { runId: string; postingId: string }) {
  const [activeRunId, setActiveRunId] = useState(runId);
  const [run, setRun] = useState<PolledTailorRun | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const res = await fetch(`/api/tailor/runs?posting_id=${encodeURIComponent(postingId)}`);
      const body: { runs: PolledTailorRun[] } = await res.json();
      const match = (body.runs ?? []).find((r) => r.id === activeRunId);
      if (cancelled) return;
      if (!match) {
        setNotFound(true);
        return;
      }
      setRun(match);
      if (match.status === "queued" || match.status === "running") {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeRunId, postingId]);

  if (notFound) {
    return <Banner tone="danger">This tailor run couldn't be found.</Banner>;
  }
  if (!run) {
    return <Spinner />;
  }
  if (run.status === "queued" || run.status === "running") {
    return <GeneratingPanel run={run} />;
  }
  if (run.status === "failed") {
    return (
      <FailedPanel
        run={run}
        postingId={postingId}
        onRetried={(newRunId) => {
          setRun(null);
          setNotFound(false);
          setActiveRunId(newRunId);
        }}
      />
    );
  }

  // run.status === "succeeded" — succeeded-state content is added in Task 9.
  return null;
}
