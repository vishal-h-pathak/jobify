"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Admin action (ADM-3 §5): un-stick one onboarding module for one user —
 * clears its completion entry in `onboarding_sessions.modules` so the
 * module's own regeneration route treats it as incomplete again. Reuses
 * `moduleKeys` passed down from the server (via `review.onboarding.modules`)
 * instead of importing `MODULE_REGISTRY` client-side, keeping this a plain
 * presentational client component.
 */
export function ResetModuleButton({ userId, moduleKeys }: { userId: string; moduleKeys: string[] }) {
  const [moduleKey, setModuleKey] = useState(moduleKeys[0] ?? "");
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "busy" || !moduleKey) return;
    setStatus("busy");
    setMessage("");
    try {
      const res = await fetch("/api/admin/reset-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, module: moduleKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      setStatus("done");
      setMessage(body.changed ? `${moduleKey} reset — it will regenerate next time it runs.` : `${moduleKey} was already incomplete.`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <select
        value={moduleKey}
        onChange={(e) => setModuleKey(e.target.value)}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
      >
        {moduleKeys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" busy={status === "busy"}>
        Reset module
      </Button>
      {message && <p className={`text-xs ${status === "error" ? "text-danger" : "text-ink-muted"}`}>{message}</p>}
    </form>
  );
}
