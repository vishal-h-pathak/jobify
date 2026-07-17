// web/components/feed/TailorAction.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { deriveTailorState, type TailorCardState } from "@/components/tailor/types";
import { interpretTailorResponse } from "@/app/(app)/feed/tailorOutcome";
import type { PolledTailorRun } from "@/lib/tailor/pollRuns";

function tailorHref(runId: string, postingId: string): string {
  return `/tailor/${runId}?posting=${encodeURIComponent(postingId)}`;
}

export function TailorAction({ postingId }: { postingId: string }) {
  const [state, setState] = useState<TailorCardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tailor/runs?posting_id=${encodeURIComponent(postingId)}`)
      .then((res) => res.json())
      .then((body: { runs: PolledTailorRun[] }) => {
        if (!cancelled) setState(deriveTailorState(body.runs ?? []));
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "tailorable" });
      });
    return () => {
      cancelled = true;
    };
  }, [postingId]);

  async function startTailor() {
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
      window.location.href = tailorHref(outcome.runId, postingId);
      return;
    }
    setMessage(outcome.message);
  }

  if (state === null) return null;

  if (state.kind === "generating") {
    return (
      <Link
        href={tailorHref(state.runId, postingId)}
        className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
      >
        Generating…
      </Link>
    );
  }

  if (state.kind === "materials") {
    return (
      <Link
        href={tailorHref(state.runId, postingId)}
        className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-amber hover:text-amber-hover"
      >
        Materials
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="ghost" busy={busy} onClick={startTailor}>
        Tailor this
      </Button>
      {message && <p className="text-xs text-ink-muted">{message}</p>}
    </div>
  );
}
