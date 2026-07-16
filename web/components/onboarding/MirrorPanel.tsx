"use client";

import { useEffect, useReducer } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Input";

export type MirrorParagraphs = [string, string];

export type MirrorPhase = "generating" | "ready" | "editing" | "submitting" | "regenerating" | "error" | "finished";

export interface MirrorState {
  phase: MirrorPhase;
  paragraphs: MirrorParagraphs;
  quotedPhrases: string[];
  draftParagraphs: MirrorParagraphs;
  regenUsed: boolean;
  error: string | null;
  reloadToken: number;
}

export function initialMirrorState(): MirrorState {
  return {
    phase: "generating",
    paragraphs: ["", ""],
    quotedPhrases: [],
    draftParagraphs: ["", ""],
    regenUsed: false,
    error: null,
    reloadToken: 0,
  };
}

export type MirrorAction =
  | { type: "generate_retried" }
  | { type: "draft_loaded"; paragraphs: MirrorParagraphs; quotedPhrases: string[] }
  | { type: "generate_failed"; error: string }
  | { type: "edit_started" }
  | { type: "edit_paragraph_changed"; index: 0 | 1; value: string }
  | { type: "edit_cancelled" }
  | { type: "regenerate_started" }
  | { type: "regenerate_succeeded"; paragraphs: MirrorParagraphs; quotedPhrases: string[] }
  | { type: "regenerate_failed"; error: string }
  | { type: "accept_started"; paragraphs: MirrorParagraphs }
  | { type: "accept_succeeded" }
  | { type: "accept_failed"; error: string };

export function mirrorReducer(state: MirrorState, action: MirrorAction): MirrorState {
  switch (action.type) {
    case "generate_retried":
      return { ...state, phase: "generating", error: null, reloadToken: state.reloadToken + 1 };
    case "draft_loaded":
      return { ...state, phase: "ready", paragraphs: action.paragraphs, quotedPhrases: action.quotedPhrases, error: null };
    case "generate_failed":
      return { ...state, phase: "error", error: action.error };
    case "edit_started":
      return { ...state, phase: "editing", draftParagraphs: [...state.paragraphs] as MirrorParagraphs };
    case "edit_paragraph_changed": {
      const draftParagraphs = [...state.draftParagraphs] as MirrorParagraphs;
      draftParagraphs[action.index] = action.value;
      return { ...state, draftParagraphs };
    }
    case "edit_cancelled":
      return { ...state, phase: "ready" };
    case "regenerate_started":
      // Marked used immediately — one regen max, client-side, regardless of
      // whether the call ends up succeeding (V3A-B2 task 6 brief).
      return { ...state, phase: "regenerating", regenUsed: true, error: null };
    case "regenerate_succeeded":
      return { ...state, phase: "ready", paragraphs: action.paragraphs, quotedPhrases: action.quotedPhrases };
    case "regenerate_failed":
      return { ...state, phase: "ready", error: action.error };
    case "accept_started":
      return { ...state, phase: "submitting", paragraphs: action.paragraphs, error: null };
    case "accept_succeeded":
      return { ...state, phase: "finished" };
    case "accept_failed":
      return { ...state, phase: "ready", error: action.error };
    default:
      return state;
  }
}

/** One regen max, tracked client-side — the server also caps it, but the
 * button itself must reflect the cap (V3A-B2 task 6 brief). */
export function canTryAgain(state: MirrorState): boolean {
  return !state.regenUsed && state.phase === "ready";
}

interface MirrorDraftResponse {
  paragraphs: MirrorParagraphs;
  quoted_phrases: string[];
}

export async function generateMirror(fetchImpl: typeof fetch): Promise<MirrorDraftResponse> {
  const res = await fetchImpl("/api/onboarding/modules/mirror/generate", { method: "POST" });
  if (!res.ok) throw new Error("failed to generate the mirror draft");
  return res.json();
}

export async function acceptMirror(
  paragraphs: MirrorParagraphs,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; key: string; receipt: string }> {
  const res = await fetchImpl("/api/onboarding/modules/mirror/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paragraphs }),
  });
  if (!res.ok) throw new Error("failed to accept the mirror draft");
  return res.json();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps the user's own quoted phrases with an amber underline-tint. No
 * reusable `color-mix(amber 25%)` utility exists in globals.css yet (grepped
 * per the brief), so this is the sanctioned fallback: a plain Tailwind
 * arbitrary-value underline, not a new CSS class. */
export function highlightQuotedPhrases(text: string, phrases: string[]): ReactNode {
  const cleaned = phrases.filter((p) => p.trim().length > 0);
  if (cleaned.length === 0) return text;

  // Longest first so a longer phrase isn't shadowed by a shorter one it contains.
  const sorted = [...cleaned].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map(escapeRegExp).join("|")})`, "g");
  const parts = text.split(pattern);

  return parts.map((part, i) =>
    sorted.includes(part) ? (
      <span key={i} className="underline decoration-amber/40">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export interface MirrorReflectionViewProps {
  phase: MirrorPhase;
  paragraphs: MirrorParagraphs;
  quotedPhrases: string[];
  draftParagraphs: MirrorParagraphs;
  canTryAgain: boolean;
  error: string | null;
  onAccept: () => void;
  onEditStart: () => void;
  onEditChange: (index: 0 | 1, value: string) => void;
  onRegenerate: () => void;
}

/** Stateless — the reveal UI as a pure function of props, so the
 * "Try again disabled after one use" and "edit-in-place" contracts are
 * directly testable without a DOM (this repo's vitest config runs in
 * `node`, no jsdom). V3A_DESIGN.md §2.3. */
export function MirrorReflectionView({
  phase,
  paragraphs,
  quotedPhrases,
  draftParagraphs,
  canTryAgain,
  error,
  onAccept,
  onEditStart,
  onEditChange,
  onRegenerate,
}: MirrorReflectionViewProps) {
  const isEditing = phase === "editing";
  const submitting = phase === "submitting";
  const regenerating = phase === "regenerating";
  const busy = submitting || regenerating;
  const displayed = isEditing ? draftParagraphs : paragraphs;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-3xl tracking-tight text-ink">Here&apos;s who we think you are. You get final say.</h2>

      <div className="flex flex-col gap-4">
        {displayed.map((paragraph, i) => (
          <div key={i} className="message-enter">
            {isEditing ? (
              <TextArea
                value={draftParagraphs[i]}
                onChange={(e) => onEditChange(i as 0 | 1, e.target.value)}
              />
            ) : (
              <p className="max-w-prose text-lg leading-relaxed text-ink">{highlightQuotedPhrases(paragraph, quotedPhrases)}</p>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" busy={submitting} disabled={busy} onClick={onAccept}>
          That&apos;s me — finish my profile
        </Button>
        {!isEditing && (
          <Button variant="ghost" disabled={busy} onClick={onEditStart}>
            Edit it
          </Button>
        )}
        <Button variant="ghost" busy={regenerating} disabled={busy || isEditing || !canTryAgain} onClick={onRegenerate}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export interface MirrorPanelProps {
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

/** V3A_DESIGN.md §2.3 — the mirror moment. Generates on mount; accept is
 * zero-LLM and completes onboarding server-side. Mirror's own completion is
 * terminal and routes to /profile — see page.tsx's `handleMirrorComplete`,
 * which is why this panel's `onComplete` is wired directly to that redirect
 * rather than `onModuleComplete("mirror")`. */
export function MirrorPanel({ onComplete, fetchImpl = fetch }: MirrorPanelProps) {
  const [state, dispatch] = useReducer(mirrorReducer, undefined, initialMirrorState);

  useEffect(() => {
    let cancelled = false;
    generateMirror(fetchImpl)
      .then((draft) => {
        if (!cancelled) dispatch({ type: "draft_loaded", paragraphs: draft.paragraphs, quotedPhrases: draft.quoted_phrases });
      })
      .catch((err) => {
        if (!cancelled) dispatch({ type: "generate_failed", error: err instanceof Error ? err.message : "failed" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reloadToken]);

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  function handleAccept() {
    if (state.phase !== "ready" && state.phase !== "editing") return;
    const paragraphs = state.phase === "editing" ? state.draftParagraphs : state.paragraphs;
    dispatch({ type: "accept_started", paragraphs });
    acceptMirror(paragraphs, fetchImpl)
      .then(() => dispatch({ type: "accept_succeeded" }))
      .catch((err) => dispatch({ type: "accept_failed", error: err instanceof Error ? err.message : "failed" }));
  }

  function handleRegenerate() {
    if (!canTryAgain(state)) return;
    dispatch({ type: "regenerate_started" });
    generateMirror(fetchImpl)
      .then((draft) => dispatch({ type: "regenerate_succeeded", paragraphs: draft.paragraphs, quotedPhrases: draft.quoted_phrases }))
      .catch((err) => dispatch({ type: "regenerate_failed", error: err instanceof Error ? err.message : "failed" }));
  }

  if (state.phase === "generating") {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Reading everything you&apos;ve told us…
      </p>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-danger">{state.error}</p>
        <Button variant="secondary" onClick={() => dispatch({ type: "generate_retried" })}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <MirrorReflectionView
      phase={state.phase}
      paragraphs={state.paragraphs}
      quotedPhrases={state.quotedPhrases}
      draftParagraphs={state.draftParagraphs}
      canTryAgain={canTryAgain(state)}
      error={state.error}
      onAccept={handleAccept}
      onEditStart={() => dispatch({ type: "edit_started" })}
      onEditChange={(index, value) => dispatch({ type: "edit_paragraph_changed", index, value })}
      onRegenerate={handleRegenerate}
    />
  );
}
