"use client";

/**
 * Modal shell — scrim + centered hairline panel, Esc / scrim-click to
 * close. Square corners, raised surface, no shadow (depth = surface
 * step + hairline, per the system).
 */

import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  label,
  onClose,
  children,
  maxWidth = "max-w-md",
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog so Esc + tabbing work immediately.
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidth} border border-rule bg-bg-raised p-5 outline-none`}
      >
        {children}
      </div>
    </div>
  );
}

/** Mono section label used at the top of modals and panels. */
export function ModalTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
      {children}
    </div>
  );
}
