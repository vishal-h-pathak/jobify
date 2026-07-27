"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { interpretClaimResponse } from "./claimOutcome";

type Status = "idle" | "busy" | "conflict" | "error" | "success";

/**
 * AUTHFLOW rule 3: claiming honors `next`. `next` arrives here already
 * sanitized by the page (the untrusted-input boundary), so this is just
 * the fallback for the common case — no code was mid-flight, land on
 * onboarding as before.
 */
export function resolveClaimDestination(next: string | null): string {
  return next ?? "/onboarding";
}

export function InviteForm({ initialCode, next }: { initialCode: string; next: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("busy");
    setMessage("");

    const res = await fetch("/api/invite/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    const outcome = interpretClaimResponse(res.status, body);

    if (outcome.kind === "success") {
      setStatus("success");
      router.push(resolveClaimDestination(next));
      return;
    }
    setStatus(outcome.kind);
    setMessage(outcome.message);
  }

  if (status === "success") {
    return (
      <Card className="w-full max-w-sm text-center">
        <p className="text-sm text-ink">You&apos;re in.</p>
      </Card>
    );
  }

  return (
    <Card className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-center text-xl font-semibold tracking-tight text-ink">Enter your invite code</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          type="text"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="invite code"
          className="text-center font-mono"
        />
        <Button type="submit" variant="primary" busy={status === "busy"}>
          Claim invite
        </Button>
      </form>
      {status === "conflict" && (
        <Banner tone="warn">
          <p>{message}</p>
          <p className="mt-1 text-ink-muted">Ask whoever sent you here for another code.</p>
        </Banner>
      )}
      {status === "error" && <Banner tone="danger">{message}</Banner>}
    </Card>
  );
}
