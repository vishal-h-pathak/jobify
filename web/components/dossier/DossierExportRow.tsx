"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * D5 (UX1_DESIGN.md §3): "Your dossier, yours to keep." Download hits the
 * server route directly (no JS needed for that one); copy and print are
 * the two client-only affordances. `copyBlock` is computed server-side by
 * `deriveDossier` + `renderDossierCopyBlock` (page.tsx) and handed down —
 * this component never re-derives it.
 */
export function DossierExportRow({ copyBlock }: { copyBlock: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    await navigator.clipboard.writeText(copyBlock);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="print:hidden flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-medium text-ink">Your dossier, yours to keep</h2>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/api/profile/export"
          className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-ink-muted"
        >
          Download (.md)
        </a>
        <Button variant="secondary" onClick={onCopy}>
          {copied ? "Copied!" : "Copy for AI tools"}
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </section>
  );
}
