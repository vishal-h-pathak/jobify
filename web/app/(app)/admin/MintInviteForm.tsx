"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

const N_OPTIONS = [1, 3, 5] as const;
type NOption = (typeof N_OPTIONS)[number];

export function MintInviteForm() {
  const router = useRouter();
  const [n, setN] = useState<NOption>(1);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState("");
  const [mintedCodes, setMintedCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function mint() {
    if (minting) return;
    setMinting(true);
    setError("");
    setMintedCodes([]);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setMintedCodes(data.codes ?? []);
      router.refresh(); // re-fetch the invites table below with the new rows
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setMinting(false);
    }
  }

  async function copyLink(code: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/invite?code=${code}`);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode((current) => (current === code ? null : current)), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {N_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setN(option)}
            aria-pressed={n === option}
            className={`rounded-md border px-2.5 py-1 text-sm font-medium ${
              n === option ? "border-amber bg-amber/15 text-amber" : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            {option}
          </button>
        ))}
        <Button variant="primary" onClick={mint} busy={minting}>
          Mint invite{n > 1 ? "s" : ""}
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {mintedCodes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-amber/30 bg-amber/10 p-3">
          {mintedCodes.map((code) => (
            <div key={code} className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="font-mono text-sm text-ink">{code}</span>
                <span className="font-mono text-xs text-ink-muted">/invite?code={code}</span>
              </div>
              <Button variant="secondary" onClick={() => copyLink(code)}>
                {copiedCode === code ? "Copied!" : "Copy link"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
