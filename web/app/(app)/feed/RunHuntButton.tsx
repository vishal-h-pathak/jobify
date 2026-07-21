"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { interpretHuntResponse } from "./huntOutcome";
import { formatCooldownRemaining, formatStartedAt, type HuntButtonState } from "./huntButtonState";

type Status = "idle" | "busy" | "running" | "stopped" | "cooldown" | "error";

const POLL_INTERVAL_MS = 20_000;
const POLL_TOTAL_MS = 5 * 60_000;

export function initialStatusFrom(state: HuntButtonState | undefined): Status {
  if (state?.kind === "in_progress") return "running";
  if (state?.kind === "cooldown") return "cooldown";
  if (state?.kind === "error") return "error";
  return "idle";
}

export function initialMessageFrom(state: HuntButtonState | undefined, now: Date = new Date()): string {
  if (state?.kind === "cooldown") return `Next hunt available in ${formatCooldownRemaining(state.availableAt, now)}.`;
  if (state?.kind === "error") return "Last hunt hit an error — try again.";
  return "";
}

/**
 * "Run my hunt" (HNT-1): scoring is no longer automatic, so this button
 * is the feed's primary way to get fresh matches. 2026-07-21 fix: initial
 * state is now server-derived (`deriveHuntButtonState`, computed fresh on
 * every feed load from `profiles.last_hunt_requested_at` + recent
 * `hunt_cycles`) instead of always starting at "idle" — navigating away
 * mid-run and back used to re-show a clickable button (double-dispatch
 * risk). A click's own in-flight/polling states remain client-local.
 */
export function RunHuntButton({ userId, initialState }: { userId?: string; initialState?: HuntButtonState } = {}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(() => initialStatusFrom(initialState));
  const [message, setMessage] = useState(() => initialMessageFrom(initialState));
  const [startedAt, setStartedAt] = useState<string | undefined>(
    initialState?.kind === "in_progress" ? initialState.startedAt : undefined
  );
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (pollStopRef.current) clearTimeout(pollStopRef.current);
    };
  }, []);

  async function run() {
    if (status === "busy" || status === "running" || status === "cooldown") return;
    setStatus("busy");
    setMessage("");

    const res = await fetch("/api/hunt/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(userId ? { userId } : {}),
    });
    const body = await res.json().catch(() => ({}));
    const outcome = interpretHuntResponse(res.status, body);

    if (outcome.kind === "cooldown") {
      setStatus("cooldown");
      setMessage(outcome.message);
      return;
    }
    if (outcome.kind === "error") {
      setStatus("error");
      setMessage(outcome.message);
      return;
    }

    setStatus("running");
    setStartedAt(new Date().toISOString());
    router.refresh();
    pollTimerRef.current = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    pollStopRef.current = setTimeout(() => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setStatus("stopped");
    }, POLL_TOTAL_MS);
  }

  if (status === "running") {
    return (
      <div className="flex flex-col gap-1">
        <Button variant="secondary" disabled busy>
          Hunt in progress…
        </Button>
        <p className="text-xs text-ink-muted">
          {startedAt
            ? `Started ${formatStartedAt(startedAt)} — results usually land in ~3 minutes.`
            : "Results usually land in ~3 minutes."}
        </p>
      </div>
    );
  }

  if (status === "cooldown") {
    return (
      <div className="flex flex-col gap-1">
        <Button variant="secondary" disabled>
          Run my hunt
        </Button>
        <p className="text-xs text-ink-muted">{message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="primary" onClick={run} busy={status === "busy"}>
        Run my hunt
      </Button>
      {status === "stopped" && <p className="text-xs text-ink-muted">Refresh to check for new results.</p>}
      {status === "error" && (
        <p className="text-xs text-danger">{message}</p>
      )}
    </div>
  );
}
