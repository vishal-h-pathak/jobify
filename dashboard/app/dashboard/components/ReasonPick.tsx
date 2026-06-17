"use client";

/**
 * ReasonPick — one-click reject-with-reason.
 *
 * Skip/dismiss actions open this quick-pick: four canned reasons that
 * map to the disqualifier patterns the analyzer (J-6) tracks, a
 * free-text "other", and an explicit no-reason path. The reason is
 * never required — friction here would kill the learning loop, not
 * feed it. Keys 1–4 pick instantly.
 */

import { useEffect, useState } from "react";
import { Btn } from "./Button";
import { Modal, ModalTitle } from "./Modal";

export const CANNED_REASONS = [
  "degree gate (MS/PhD required)",
  "defense-adjacent",
  "not experimental enough",
  "comp too low",
] as const;

export function ReasonPick({
  title,
  verb,
  onPick,
  onCancel,
}: {
  /** e.g. "Skip — Neuromorphic Engineer @ eon.systems" */
  title: string;
  /** Confirm button label, e.g. "Skip" / "Ignore". */
  verb: string;
  /** reason === null → proceed without a reason. */
  onPick: (reason: string | null) => void;
  onCancel: () => void;
}) {
  const [other, setOther] = useState("");
  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showOther) return; // typing in the textarea
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= CANNED_REASONS.length) {
        e.preventDefault();
        onPick(CANNED_REASONS[n - 1]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onPick, showOther]);

  return (
    <Modal label={title} onClose={onCancel}>
      <ModalTitle>{title}</ModalTitle>
      <div className="flex flex-col gap-1.5">
        {CANNED_REASONS.map((r, i) => (
          <button
            key={r}
            type="button"
            onClick={() => onPick(r)}
            className="flex items-baseline gap-2.5 border border-rule-soft bg-bg px-3 py-2 text-left font-mono text-xs text-ink transition-colors duration-150 hover:border-amber hover:text-amber"
          >
            <span className="text-ink-faint tabular-nums">{i + 1}</span>
            {r}
          </button>
        ))}
        {showOther ? (
          <form
            className="mt-1 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onPick(other.trim() || null);
            }}
          >
            <input
              autoFocus
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="reason…"
              className="border border-rule bg-bg px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <Btn type="submit" variant="primary">
                {verb} with reason
              </Btn>
              <Btn type="button" variant="ghost" onClick={() => setShowOther(false)}>
                back
              </Btn>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowOther(true)}
            className="border border-dashed border-rule-soft bg-bg px-3 py-2 text-left font-mono text-xs text-ink-dim transition-colors duration-150 hover:border-amber hover:text-amber"
          >
            other…
          </button>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-rule-soft pt-3">
        <Btn variant="ghost" onClick={() => onPick(null)}>
          {verb} without reason
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>
          cancel
        </Btn>
      </div>
    </Modal>
  );
}
