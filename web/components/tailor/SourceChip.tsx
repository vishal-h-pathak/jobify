"use client";

import { useState } from "react";
import type { ClaimUnit, NumberToken } from "./types";

const FILE_LABELS: Record<string, string> = { "cv.md": "your resume" };

function fileLabel(file: string): string {
  return FILE_LABELS[file] ?? file;
}

/** The chip's visible text — never renders a quote itself, only the receipt. */
export function claimChipLabel(unit: ClaimUnit): string {
  if (unit.status === "user_edited") return "yours";
  if (unit.kind === "voice") return "your voice";
  const source = unit.sources?.[0];
  if (!source) return "unsourced";
  return source.start_line ? `from ${fileLabel(source.file)}, line ${source.start_line}` : `from ${fileLabel(source.file)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits `text` around every confirmed number token so the caller can style
 * the metric segments distinctly (the amber metric-chip look, §3.3). A unit
 * with no numbers passes through untouched as a single non-metric segment.
 */
export function highlightNumbers(text: string, numbers: NumberToken[] = []): Array<{ text: string; isMetric: boolean }> {
  const tokens = numbers.map((n) => n.token).filter(Boolean);
  if (tokens.length === 0) return [{ text, isMetric: false }];
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
  return text.split(pattern).map((part) => ({ text: part, isMetric: tokens.includes(part) }));
}

export function SourceChip({ unit }: { unit: ClaimUnit }) {
  const [open, setOpen] = useState(false);
  const label = claimChipLabel(unit);
  const source = unit.sources?.[0];
  const isYours = unit.status === "user_edited";
  const isVoice = unit.kind === "voice";

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
          isYours || isVoice
            ? "border-line text-ink-muted"
            : "border-line text-ink-muted hover:border-amber hover:text-amber"
        }`}
      >
        {label}
      </button>
      {open && source && (
        <span className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-line bg-surface p-2 text-xs text-ink shadow-lg shadow-black/20">
          &ldquo;{source.quote}&rdquo;
        </span>
      )}
    </span>
  );
}
