"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { DROPPED_REASON_COPY, type DroppedUnit } from "./types";

export function summarizeDropped(dropped: DroppedUnit[]): string {
  return `${dropped.length} claim${dropped.length === 1 ? "" : "s"} withheld`;
}

/**
 * The trust feature (design §3.3): a collapsed list of everything the
 * verifier dropped, always present when non-empty — never hidden behind a
 * dismissable toast or an easy-to-miss corner. Collapsed by default so it
 * doesn't dominate a mostly-clean run, but the summary line itself always
 * shows the count.
 */
export function HonestyDrawer({ dropped }: { dropped: DroppedUnit[] }) {
  const [open, setOpen] = useState(false);
  if (dropped.length === 0) return null;

  return (
    <Banner tone="warn" className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-left font-medium text-ink">
        {summarizeDropped(dropped)} — no source in your profile {open ? "▲" : "▼"}
      </button>
      {open && (
        <ul className="flex flex-col gap-2 border-t border-line pt-2">
          {dropped.map((d) => (
            <li key={d.id} className="text-xs text-ink-muted">
              <span className="text-ink">{d.text}</span> — {DROPPED_REASON_COPY[d.reason]}
            </li>
          ))}
        </ul>
      )}
    </Banner>
  );
}
