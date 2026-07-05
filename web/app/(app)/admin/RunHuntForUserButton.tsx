"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Status = "idle" | "busy" | "done" | "error";

/**
 * Admin-only "Run hunt for user" (HNT-1 task 6): dispatches the same
 * `POST /api/hunt/run` route the feed button uses, but with `{ userId }`
 * set to a specific row's user — only honored server-side because the
 * caller is an admin (see lib/hunt/dispatchHunt.ts). Admins bypass the
 * cooldown, so there's no cooldown state to render here, unlike the feed
 * button.
 */
export function RunHuntForUserButton({ userId }: { userId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function run() {
    if (status === "busy") return;
    setStatus("busy");
    setMessage("");

    const res = await fetch("/api/hunt/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus("error");
      setMessage(body.error ?? "Something went wrong.");
      return;
    }
    setStatus("done");
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" onClick={run} busy={status === "busy"} disabled={status === "done"}>
        {status === "done" ? "Dispatched" : "Run hunt"}
      </Button>
      {status === "error" && <p className="text-xs text-danger">{message}</p>}
    </div>
  );
}
