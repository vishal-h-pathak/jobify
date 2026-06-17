"use client";

/**
 * Toast rail — bottom-right, mono, on-brand, no dependency.
 *
 * For action results that happen off-screen (dispatches, background
 * failures, bulk summaries). Auto-dismisses after 4s, manually
 * dismissible, reduced-motion aware (the enter animation is gated in
 * _internal.css). Errors persist 8s — reading time matters more when
 * something broke.
 *
 * ToastProvider mounts once in app/dashboard/layout.tsx; everything
 * below it calls useToast().push(tone, message).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Tone = "ok" | "error" | "info";

type Toast = {
  id: number;
  tone: Tone;
  message: string;
};

type ToastApi = {
  push: (tone: Tone, message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-l-green text-ink",
  error: "border-l-red text-ink",
  info: "border-l-rule text-ink-dim",
};

const TONE_MARK: Record<Tone, { glyph: string; cls: string }> = {
  ok: { glyph: "✓", cls: "text-green" },
  error: { glyph: "✗", cls: "text-red" },
  info: { glyph: "·", cls: "text-ink-faint" },
};

const DISMISS_MS: Record<Tone, number> = {
  ok: 4000,
  info: 4000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), DISMISS_MS[tone]);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter flex items-start gap-2 border border-rule border-l-2 bg-bg-raised px-3 py-2 text-xs ${TONE_CLASS[t.tone]}`}
          >
            <span aria-hidden="true" className={TONE_MARK[t.tone].cls}>
              {TONE_MARK[t.tone].glyph}
            </span>
            <span className="min-w-0 flex-1 break-words leading-relaxed">
              {t.message}
            </span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="px-1 text-ink-faint transition-colors duration-150 hover:text-ink"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
