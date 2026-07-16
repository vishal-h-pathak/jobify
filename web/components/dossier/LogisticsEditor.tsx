"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { FactsBand } from "@/lib/dossier/derive";

export interface LogisticsPatchBody {
  base?: string;
  remote_acceptable?: boolean;
  target_comp_usd?: string;
}

export interface LogisticsFormValues {
  base: string;
  remoteAcceptable: boolean;
  targetCompUsd: string;
}

/** Typed-field edit rule (V3A_DESIGN §3 one-sentence rule): only fields the
 * user typed are inline-editable. Comp floor + location/remote are the two
 * typed fields this session owns (session-prompts/33 build item 3) — pure
 * so the PATCH body shape is unit-testable without a DOM. */
export function buildLogisticsPatchBody(form: LogisticsFormValues): LogisticsPatchBody {
  const body: LogisticsPatchBody = {};
  if (form.base.trim()) body.base = form.base.trim();
  body.remote_acceptable = form.remoteAcceptable;
  if (form.targetCompUsd.trim()) body.target_comp_usd = form.targetCompUsd.trim();
  return body;
}

export function initialLogisticsForm(logistics: FactsBand["logistics"]): LogisticsFormValues {
  return {
    base: logistics.base ?? "",
    remoteAcceptable: logistics.remoteAcceptable ?? false,
    targetCompUsd: logistics.targetCompUsd ?? "",
  };
}

export async function submitLogisticsPatch(
  body: LogisticsPatchBody,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetchImpl("/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    return { ok: false, error: payload.error ?? "Could not save your changes." };
  }
  return { ok: true };
}

export function LogisticsEditor({ logistics }: { logistics: FactsBand["logistics"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LogisticsFormValues>(() => initialLogisticsForm(logistics));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const result = await submitLogisticsPatch(buildLogisticsPatchBody(form));
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex items-center gap-2">
          <dt className="text-ink-muted">Location</dt>
          <dd className="text-ink">{logistics.base ?? "—"}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-ink-muted">Remote</dt>
          <dd className="text-ink">{logistics.remoteAcceptable ? "Open to remote" : "On-site preferred"}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-ink-muted">Comp floor</dt>
          <dd className="text-ink">{logistics.targetCompUsd ?? "—"}</dd>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1 self-start text-xs text-ink-muted hover:text-amber"
        >
          Edit
        </button>
      </dl>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-ink-muted">Location</span>
        <Input value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={form.remoteAcceptable}
          onChange={(e) => setForm({ ...form, remoteAcceptable: e.target.checked })}
        />
        <span className="text-ink-muted">Open to remote</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-ink-muted">Comp floor</span>
        <Input value={form.targetCompUsd} onChange={(e) => setForm({ ...form, targetCompUsd: e.target.value })} />
      </label>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex items-center gap-2 focus-within:ring-2 focus-within:ring-amber">
        <Button variant="primary" busy={saving} onClick={save}>
          Save
        </Button>
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setForm(initialLogisticsForm(logistics));
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
