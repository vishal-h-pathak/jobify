"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function KeyForm({ initialKeyLast4 }: { initialKeyLast4: string | null }) {
  const [keyLast4, setKeyLast4] = useState(initialKeyLast4);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const key = input.trim();
    if (!key || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setKeyLast4(data.keyLast4 ?? null);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/keys", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Something went wrong.");
      }
      setKeyLast4(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (keyLast4) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink">
            Key on file: <span className="font-mono">…{keyLast4}</span>
          </p>
          <Button variant="danger-ghost" onClick={remove} busy={saving}>
            Remove
          </Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="sk-ant-..."
          className="flex-1"
        />
        <Button variant="primary" onClick={save} busy={saving} disabled={!input.trim()}>
          Save
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
