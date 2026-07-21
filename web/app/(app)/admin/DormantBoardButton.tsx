"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * HUNT2 P3 S6: the "Sources" card's dormant-candidate row action — sets
 * `board_catalog.status='dormant'` for one board. Detection
 * (`dormantCandidate`, `sourceHealth.ts`) is automatic; this click is the
 * only thing that ever actually flips the status.
 */
export function DormantBoardButton({ boardId }: { boardId: string }) {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    if (status === "busy" || status === "done") return;
    setStatus("busy");
    setMessage("");
    try {
      const res = await fetch("/api/admin/sources/dormant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boardId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "done") {
    return <span className="text-xs text-ink-muted">marked dormant</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" busy={status === "busy"} onClick={handleClick}>
        Set dormant
      </Button>
      {message && <p className="text-xs text-danger">{message}</p>}
    </div>
  );
}
