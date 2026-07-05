"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { interpretHuntResponse } from "./huntOutcome";

type Status = "idle" | "busy" | "running" | "stopped" | "cooldown" | "error";

const POLL_INTERVAL_MS = 20_000;
const POLL_TOTAL_MS = 5 * 60_000;

/**
 * "Run my hunt" (HNT-1): scoring is no longer automatic, so this button
 * is the feed's primary way to get fresh matches. States are driven
 * purely by the fetch response — no server-preloaded cooldown state, so
 * a page reload mid-cooldown shows idle again until the next click (which
 * then correctly re-shows the cooldown message from a fresh 429).
 */
export function RunHuntButton({ userId }: { userId?: string } = {}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (pollStopRef.current) clearTimeout(pollStopRef.current);
    };
  }, []);

  async function run() {
    if (status === "busy" || status === "running") return;
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
          Hunt running
        </Button>
        <p className="text-xs text-ink-muted">Results usually land in ~3 minutes.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="primary" onClick={run} busy={status === "busy"}>
        Run my hunt
      </Button>
      {status === "stopped" && <p className="text-xs text-ink-muted">Refresh to check for new results.</p>}
      {(status === "cooldown" || status === "error") && (
        <p className={`text-xs ${status === "error" ? "text-danger" : "text-ink-muted"}`}>{message}</p>
      )}
    </div>
  );
}
