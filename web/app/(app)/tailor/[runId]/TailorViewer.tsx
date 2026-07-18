"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TAILOR_STAGES } from "@/components/tailor/types";
import { interpretTailorResponse } from "@/app/(app)/feed/tailorOutcome";
import type { PolledTailorRun } from "@/lib/tailor/pollRuns";
import { ResumeView } from "@/components/tailor/ResumeView";
import { CoverLetterView } from "@/components/tailor/CoverLetterView";
import { HonestyDrawer } from "@/components/tailor/HonestyDrawer";
import { TemplateSwitcher } from "@/components/tailor/TemplateSwitcher";
import type { ClaimsJson, ClaimUnit } from "@/components/tailor/types";

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

/**
 * Applies a local, in-memory edit: the *only* place `status:"user_edited"`
 * is ever assigned in this app (there is no backend persistence route for
 * it — see Global Constraints). Sources/numbers are cleared because an
 * edited unit is the user's own assertion, not a sourced claim; keeping
 * stale sources around would let a hover chip show a quote that no longer
 * matches the displayed text.
 */
export function applyUserEdit(units: ClaimUnit[], id: string, newText: string): ClaimUnit[] {
  return units.map((u) => {
    if (u.id !== id) return u;
    const { sources: _sources, numbers: _numbers, ...rest } = u;
    return { ...rest, text: newText, status: "user_edited" as const };
  });
}

interface Materials {
  claims: ClaimsJson;
  coverLetterText: string;
  urls: Record<string, string>;
}

interface ResolvedMaterialUrls {
  claimsUrl: string | undefined;
  coverLetterTextUrl: string | undefined;
  resumePdfUrl: string | undefined;
  coverLetterPdfUrl: string | undefined;
}

/**
 * Picks the 4 signed URLs the viewer actually consumes out of
 * `GET /api/tailor/materials/[runId]`'s `{urls}` map (which may also
 * contain `tailored.json`/`render_meta.json`, unused here). A pure
 * projection so the "which storage key means what" mapping is unit-tested
 * without mocking `fetch`.
 */
export function resolveMaterialUrls(urls: Record<string, string>): ResolvedMaterialUrls {
  return {
    claimsUrl: urls["claims.json"],
    coverLetterTextUrl: urls["cover_letter.txt"],
    resumePdfUrl: urls["resume.pdf"],
    coverLetterPdfUrl: urls["cover_letter.pdf"],
  };
}

function useMaterials(runId: string) {
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/tailor/materials/${runId}`);
      if (!res.ok) {
        if (!cancelled) setError("Couldn't load your materials — try refreshing.");
        return;
      }
      const { urls }: { urls: Record<string, string> } = await res.json();
      const { claimsUrl, coverLetterTextUrl } = resolveMaterialUrls(urls);
      if (!claimsUrl) {
        if (!cancelled) setError("This run has no claims data.");
        return;
      }
      const [claims, coverLetterText] = await Promise.all([
        fetch(claimsUrl).then((r) => r.json() as Promise<ClaimsJson>),
        coverLetterTextUrl ? fetch(coverLetterTextUrl).then((r) => r.text()) : Promise.resolve(""),
      ]);
      if (!cancelled) setMaterials({ claims, coverLetterText, urls });
    }
    load().catch(() => {
      if (!cancelled) setError("Couldn't load your materials — try refreshing.");
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return { materials, error };
}

function SucceededPanel({ run, postingId }: { run: PolledTailorRun; postingId: string }) {
  const { materials, error } = useMaterials(run.id);
  const [units, setUnits] = useState<ClaimUnit[] | null>(null);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [regenerateMessage, setRegenerateMessage] = useState<string | null>(null);
  const [redirectRunId, setRedirectRunId] = useState<string | null>(null);

  useEffect(() => {
    if (materials) setUnits(materials.claims.units);
  }, [materials]);

  useEffect(() => {
    if (redirectRunId && typeof window !== "undefined") {
      window.location.href = `/tailor/${redirectRunId}?posting=${encodeURIComponent(postingId)}`;
    }
  }, [redirectRunId, postingId]);

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!materials || !units) return <Spinner />;
  const { resumePdfUrl, coverLetterPdfUrl } = resolveMaterialUrls(materials.urls);

  if (redirectRunId) {
    return <Spinner />;
  }

  function editUnit(id: string, newText: string) {
    setUnits((prev) => (prev ? applyUserEdit(prev, id, newText) : prev));
  }

  async function regenerate() {
    setConfirmingRegenerate(false);
    const res = await fetch("/api/tailor/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posting_id: postingId, mode: "tailor" }),
    });
    const body = await res.json();
    const outcome = interpretTailorResponse(res.status, body);
    if (outcome.kind === "started") {
      setRedirectRunId(outcome.runId);
      return;
    }
    setRegenerateMessage(outcome.message);
  }

  return (
    <div className="rail-sweep flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TemplateSwitcher
          postingId={postingId}
          currentTemplate={run.template}
          onRun={(outcome) => {
            if (outcome.kind === "started") setRedirectRunId(outcome.runId);
            else setRegenerateMessage(outcome.message);
          }}
        />
        <div className="flex items-center gap-2">
          {resumePdfUrl && (
            <a href={resumePdfUrl} className="text-sm text-amber hover:text-amber-hover">
              Download resume
            </a>
          )}
          {coverLetterPdfUrl && (
            <a href={coverLetterPdfUrl} className="text-sm text-amber hover:text-amber-hover">
              Download letter
            </a>
          )}
          <Button variant="ghost" onClick={() => navigator.clipboard.writeText(materials.coverLetterText)}>
            Copy letter text
          </Button>
        </div>
      </div>

      <HonestyDrawer dropped={materials.claims.dropped} />

      <div className="grid gap-4 md:grid-cols-2">
        <ResumeView units={units} onEdit={editUnit} />
        <CoverLetterView units={units} onEdit={editUnit} />
      </div>

      <div className="flex flex-col items-start gap-2">
        {confirmingRegenerate ? (
          <Banner tone="warn" className="flex flex-col gap-2">
            <p>
              This re-runs the full tailor (archetype → resume → cover letter → verification → render), uses one of
              your 5 daily tailors, and costs roughly $0.20–$0.35. Continue?
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={regenerate}>
                Regenerate
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingRegenerate(false)}>
                Cancel
              </Button>
            </div>
          </Banner>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmingRegenerate(true)}>
            Regenerate
          </Button>
        )}
        {regenerateMessage && <p className="text-xs text-ink-muted">{regenerateMessage}</p>}
      </div>
    </div>
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

  if (run.status === "succeeded") {
    return <SucceededPanel run={run} postingId={postingId} />;
  }
  return null;
}
