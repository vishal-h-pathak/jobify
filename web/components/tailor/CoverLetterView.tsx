"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { SourceChip, highlightNumbers } from "./SourceChip";
import type { ClaimUnit } from "./types";

const CL_RE = /^cl\.s(\d+)$/;

/** Cover-letter sentence units, in sentence order (numeric, not array/lexical). */
export function orderCoverLetterUnits(units: ClaimUnit[]): ClaimUnit[] {
  return units
    .filter((u) => u.surface === "cover_letter" && CL_RE.test(u.id))
    .sort((a, b) => Number(CL_RE.exec(a.id)![1]) - Number(CL_RE.exec(b.id)![1]));
}

/** Same click-to-edit affordance as `ResumeView`'s `EditableClaim` (kept
 * local rather than a shared import — each view's surrounding markup
 * differs enough, inline/block, that sharing added more indirection than
 * it saved). Commits on blur/Enter, calling `onEdit(id, text)`. */
function EditableSentence({ unit, onEdit }: { unit: ClaimUnit; onEdit?: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(unit.text ?? "");

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== unit.text) onEdit?.(unit.id, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        rows={2}
        className="mb-1 block w-full rounded-md border border-line bg-base p-1.5 text-sm text-ink"
      />
    );
  }

  const segments = highlightNumbers(unit.text ?? "", unit.numbers);
  return (
    <span className="mr-1">
      {segments.map((seg, i) =>
        seg.isMetric ? (
          <span key={i} className="font-medium text-amber">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}{" "}
      <SourceChip unit={unit} />
      {onEdit && (
        <button
          type="button"
          onClick={() => {
            setDraft(unit.text ?? "");
            setEditing(true);
          }}
          className="ml-1 text-xs text-ink-muted hover:text-amber"
        >
          Edit
        </button>
      )}
    </span>
  );
}

export function CoverLetterView({ units, onEdit }: { units: ClaimUnit[]; onEdit?: (id: string, text: string) => void }) {
  const sentences = orderCoverLetterUnits(units);

  return (
    <Card className="flex flex-col gap-2">
      <p className="text-sm leading-relaxed text-ink">
        {sentences.map((sentence) => (
          <EditableSentence key={sentence.id} unit={sentence} onEdit={onEdit} />
        ))}
      </p>
    </Card>
  );
}
