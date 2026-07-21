"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { CandidateBoardView } from "@/lib/admin/candidates";

/**
 * HUNT2 P2 S4: the "Candidate boards" admin card — pending review queue
 * (one-click Approve/Reject) plus a read-only recent-auto-admits list.
 * Fetches `GET /api/admin/candidates` on mount (client-side, unlike the
 * rest of the admin page's server-fetched cards) since this queue
 * changes on every discovery cycle and an admin visiting the page wants
 * the current state, not whatever was true at the last full page load.
 */
export function CandidatesCard() {
  const [pending, setPending] = useState<CandidateBoardView[] | null>(null);
  const [recentAutoAdmitted, setRecentAutoAdmitted] = useState<CandidateBoardView[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/candidates")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setPending(data.pending ?? []);
        setRecentAutoAdmitted(data.recentAutoAdmitted ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load candidates.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleDecided(candidateId: string) {
    setPending((prev) => (prev ?? []).filter((c) => c.id !== candidateId));
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError && <p className="text-sm text-danger">{loadError}</p>}
      {pending === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : pending.length === 0 ? (
        <EmptyState heading="No pending candidates" message="The discovery loop hasn't proposed anything for review yet." />
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((candidate) => (
            <CandidateRow key={candidate.id} candidate={candidate} onDecided={handleDecided} />
          ))}
        </ul>
      )}

      {recentAutoAdmitted.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="text-sm font-medium text-ink">Recent auto-admits</h3>
          <ul className="flex flex-col gap-1 text-sm text-ink-muted">
            {recentAutoAdmitted.map((candidate) => (
              <li key={candidate.id} className="flex items-center justify-between gap-2">
                <span>
                  {candidate.companyName} — {candidate.proposedAts}/{candidate.proposedSlug}
                </span>
                <span className="text-xs">
                  {candidate.decidedAt ? new Date(candidate.decidedAt).toLocaleDateString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function probeSummary(candidate: CandidateBoardView): string {
  const probe = candidate.probeResult as {
    found?: boolean;
    confidence?: number;
    live_posting_count?: number;
    reason?: string;
  } | null;
  if (!probe) return "no probe result yet";
  if (!probe.found) return `not found on any ATS${probe.reason ? ` (${probe.reason})` : ""}`;
  const confidence = typeof probe.confidence === "number" ? probe.confidence.toFixed(2) : "?";
  return `${candidate.proposedAts}/${candidate.proposedSlug} — confidence ${confidence}, ${probe.live_posting_count ?? 0} live postings`;
}

function CandidateRow({
  candidate,
  onDecided,
}: {
  candidate: CandidateBoardView;
  onDecided: (candidateId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");

  async function decide(decision: "approve" | "reject") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/candidates/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.id, decision, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      onDecided(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const canApprove = Boolean(candidate.proposedAts && candidate.proposedSlug);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-base p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{candidate.companyName}</p>
          <p className="text-xs text-ink-muted">{probeSummary(candidate)}</p>
        </div>
        <Badge tone="neutral">{candidate.evidenceKind}</Badge>
      </div>
      {candidate.evidenceUrl && (
        <a
          href={candidate.evidenceUrl}
          target="_blank"
          rel="noreferrer"
          className="w-fit text-xs text-badge-blue underline"
        >
          evidence
        </a>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          busy={busy}
          disabled={!canApprove}
          onClick={() => decide("approve")}
        >
          {canApprove ? "Approve" : "Approve (no board found)"}
        </Button>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reject reason (optional)"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
        <Button variant="danger-ghost" busy={busy} onClick={() => decide("reject")}>
          Reject
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </li>
  );
}
