"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Validation {
  status: "valid" | "invalid";
  errors: string[];
}

export default function OnboardingPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [validation, setValidation] = useState<Validation | undefined>();
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/onboarding/state")
      .then((res) => res.json())
      .then((data) => {
        setMessages(data.messages ?? []);
        setDone(data.status === "complete");
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load your session.");
        setLoading(false);
      });
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setInput(text);
  }

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");

    try {
      const res = await fetch("/api/onboarding/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong.");
      }
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.assistantText }]);
      if (data.done) {
        setDone(true);
        setValidation(data.validation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-zinc-500">Loading…</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Building your profile</h1>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        {messages.length === 0 && (
          <p className="text-zinc-500">
            Paste your resume below (or upload a .txt/.md file) to get started — we&apos;ll walk through a short
            interview from there.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "self-end text-right" : "self-start"}>
            <div
              className={
                m.role === "user"
                  ? "inline-block rounded-lg bg-foreground px-3 py-2 text-background"
                  : "inline-block rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>

      {done ? (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="font-medium">
            {validation?.status === "invalid" ? "Profile saved, but needs a fix:" : "Your profile is built."}
          </p>
          {validation?.status === "invalid" && (
            <ul className="list-disc pl-5 text-sm text-red-600">
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <Link href="/feed" className="text-sm font-medium underline">
            Go to your feed
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your reply…"
            rows={3}
            className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex items-center justify-between gap-3">
            <input ref={fileInputRef} type="file" accept=".txt,.md" onChange={handleFileChange} className="text-sm" />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
