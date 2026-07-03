"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InvitePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("checking");
    setErrorMessage("");

    const res = await fetch("/api/invite/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus("error");
      setErrorMessage(body.error ?? "Something went wrong.");
      return;
    }

    router.push("/onboarding");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Enter your invite code</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <input
          type="text"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="invite code"
          className="rounded-md border border-zinc-300 px-4 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={status === "checking"}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {status === "checking" ? "Checking…" : "Claim invite"}
        </button>
        {status === "error" && <p className="text-sm text-red-600">{errorMessage}</p>}
      </form>
    </div>
  );
}
