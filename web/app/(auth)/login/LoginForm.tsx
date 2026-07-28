"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { GoogleIcon } from "@/components/ui/GoogleIcon";
import { buildAuthRedirectTo, canResend } from "./loginHelpers";

type EmailStatus = "idle" | "sending" | "sent" | "error";
type OAuthStatus = "idle" | "busy" | "error";

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<EmailStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>("idle");
  const [oauthError, setOauthError] = useState("");

  useEffect(() => {
    if (status !== "sent") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  async function signInWithGoogle() {
    setOauthStatus("busy");
    setOauthError("");

    const supabase = createSupabaseBrowserClient();
    const redirectTo = buildAuthRedirectTo(window.location.origin, next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    // On success the browser navigates away to Google — nothing left to do here.
    if (error) {
      setOauthStatus("error");
      setOauthError(error.message);
    }
  }

  async function sendLink(e?: FormEvent) {
    e?.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    const supabase = createSupabaseBrowserClient();
    const redirectTo = buildAuthRedirectTo(window.location.origin, next);
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
          Link sent to <span className="text-ink">{email}</span> — check your inbox.
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
      </div>
      <Button variant="primary" busy={oauthStatus === "busy"} onClick={signInWithGoogle} className="justify-center">
        <GoogleIcon className="h-4 w-4" />
        Continue with Google
      </Button>
      {oauthStatus === "error" && <p className="text-sm text-danger">{oauthError}</p>}
      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <div className="h-px flex-1 bg-line" />
        or, get a sign-in link by email
        <div className="h-px flex-1 bg-line" />
      </div>
      <form onSubmit={sendLink} className="flex flex-col gap-3">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <Button type="submit" variant="secondary" busy={status === "sending"}>
          Send sign-in link
        </Button>
        {status === "error" && <p className="text-sm text-danger">{errorMessage}</p>}
      </form>
    </Card>
  );
}
