"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { buildEmailRedirectTo, canResend } from "./loginHelpers";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (status !== "sent") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  async function sendLink(e?: FormEvent) {
    e?.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    const supabase = createSupabaseBrowserClient();
    const redirectTo = buildEmailRedirectTo(window.location.origin, next);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    const sentTime = Date.now();
    setSentAt(sentTime);
    setNow(sentTime);
    setStatus("sent");
  }

  if (status === "sent" && sentAt !== null) {
    const resendReady = canResend(sentAt, now ?? sentAt);
    return (
      <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Check your inbox</h1>
        <p className="text-sm text-ink-muted">
          We sent a link to <span className="text-ink">{email}</span> — click it to finish signing in.
        </p>
        <Button variant="ghost" onClick={() => sendLink()} disabled={!resendReady}>
          {resendReady ? "Resend link" : "Resend available shortly"}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
        <p className="text-sm text-ink-muted">Sign in with your email. No password — we send you a link.</p>
      </div>
      <form onSubmit={sendLink} className="flex flex-col gap-3">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <Button type="submit" variant="primary" busy={status === "sending"}>
          Send magic link
        </Button>
        {status === "error" && <p className="text-sm text-danger">{errorMessage}</p>}
      </form>
    </Card>
  );
}
