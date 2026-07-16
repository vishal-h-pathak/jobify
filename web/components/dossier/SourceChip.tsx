import Link from "next/link";
import type { SourceRef } from "@/lib/dossier/derive";

/**
 * Traceability chip (V3A_DESIGN §3): "from <Module> · <date>", full-strength
 * amber only on hover (amber dosage rule — everything else stays ink-muted).
 * Primary action is "Redo this module" — the chip itself deep-links there;
 * the receipt text rides along as the native title tooltip.
 */
export function SourceChip({ source }: { source: SourceRef | null }) {
  if (!source) return null;
  return (
    <Link
      href={source.href}
      title="Redo this module"
      className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-amber hover:text-amber"
    >
      from {source.label}
    </Link>
  );
}
