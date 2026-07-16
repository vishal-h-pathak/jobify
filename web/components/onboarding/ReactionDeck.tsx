"use client";

import { useEffect, useReducer, useRef } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export interface PostingSummary {
  id: string;
  title: string;
  company: string;
  location: string;
}

export type ReactionChoice = "interested" | "not_interested";

/** V3A_DESIGN.md §1.3 — six canned one-worders, plus a 24-char free field. */
export const WHY_CHIPS = ["comp", "title", "domain", "company", "level", "location"] as const;
export const WHY_AUTO_ADVANCE_MS = 2500;
export const WHY_FREE_TEXT_MAX = 24;
export const REACTION_DECK_INTRO_COPY =
  "Real postings, live right now. Gut reactions only — this is how your feed learns taste, not just keywords.";

type Phase = "loading" | "card" | "why" | "submitting" | "error" | "finished";

export interface ReactionDeckState {
  postings: PostingSummary[];
  index: number;
  phase: Phase;
  pendingReaction: ReactionChoice | null;
  note: string;
  reactionCount: number;
  complete: boolean;
  error: string | null;
}

export const initialReactionDeckState: ReactionDeckState = {
  postings: [],
  index: 0,
  phase: "loading",
  pendingReaction: null,
  note: "",
  reactionCount: 0,
  complete: false,
  error: null,
};

export type ReactionDeckAction =
  | { type: "postings_loaded"; postings: PostingSummary[] }
  | { type: "postings_load_failed"; error: string }
  | { type: "choice_made"; reaction: ReactionChoice }
  | { type: "note_changed"; note: string }
  | { type: "submit_started" }
  | { type: "submit_succeeded"; reactionCount: number; complete: boolean }
  | { type: "submit_failed"; error: string }
  | { type: "card_advanced" }
  | { type: "undo" };

export function reactionDeckReducer(state: ReactionDeckState, action: ReactionDeckAction): ReactionDeckState {
  switch (action.type) {
    case "postings_loaded":
      return { ...state, postings: action.postings, phase: action.postings.length ? "card" : "finished" };
    case "postings_load_failed":
      return { ...state, phase: "error", error: action.error };
    case "choice_made":
      return { ...state, phase: "why", pendingReaction: action.reaction, note: "" };
    case "note_changed":
      return { ...state, note: action.note.slice(0, WHY_FREE_TEXT_MAX) };
    case "submit_started":
      return { ...state, phase: "submitting", error: null };
    case "submit_succeeded":
      return { ...state, reactionCount: action.reactionCount, complete: action.complete };
    case "submit_failed":
      // Stay in 'why' so the user can retry the same choice — never lose the pending reaction/note on failure.
      return { ...state, phase: "why", error: action.error };
    case "card_advanced": {
      if (state.complete) return { ...state, phase: "finished" };
      const nextIndex = state.index + 1;
      if (nextIndex >= state.postings.length) return { ...state, phase: "finished" };
      return { ...state, index: nextIndex, phase: "card", pendingReaction: null, note: "" };
    }
    case "undo":
      if (state.index === 0) return state;
      return { ...state, index: state.index - 1, phase: "card", pendingReaction: null, note: "" };
    default:
      return state;
  }
}

export async function fetchReactionPostings(fetchImpl: typeof fetch): Promise<PostingSummary[]> {
  const res = await fetchImpl("/api/onboarding/modules/reactions");
  if (!res.ok) throw new Error("failed to load postings");
  const data = (await res.json()) as { postings: PostingSummary[] };
  return data.postings;
}

export async function submitReaction(
  postingId: string,
  reaction: ReactionChoice,
  note: string,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; reaction_count: number; complete: boolean }> {
  const res = await fetchImpl("/api/onboarding/modules/reactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ posting_id: postingId, reaction, ...(note ? { note } : {}) }),
  });
  if (!res.ok) throw new Error("failed to submit reaction");
  return res.json();
}

export interface ReactionCardViewProps {
  posting: PostingSummary;
  nextPosting: PostingSummary | undefined;
  position: number;
  total: number;
  canUndo: boolean;
  onPass: () => void;
  onInterested: () => void;
  onUndo: () => void;
}

/** The stacked deck: current card, next card peeking 8px below at 60% opacity. */
export function ReactionCardView({
  posting,
  nextPosting,
  position,
  total,
  canUndo,
  onPass,
  onInterested,
  onUndo,
}: ReactionCardViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-ink-muted">
        {canUndo ? (
          <button type="button" onClick={onUndo} aria-label="undo, back to previous card" className="text-ink-muted hover:text-ink">
            ← back
          </button>
        ) : (
          <span />
        )}
        <span>
          {position} of {total}
        </span>
      </div>
      <div className="relative">
        {nextPosting && (
          <div aria-hidden="true" className="absolute inset-x-0 top-2 opacity-60">
            <Card variant="elevated">
              <div className="text-lg text-ink">{nextPosting.title}</div>
              <div className="text-sm text-ink-muted">
                {nextPosting.company} · {nextPosting.location}
              </div>
            </Card>
          </div>
        )}
        <div className="relative panel-enter">
          <Card variant="elevated">
            <div className="text-lg text-ink">{posting.title}</div>
            <div className="text-sm text-ink-muted">
              {posting.company} · {posting.location}
            </div>
          </Card>
        </div>
      </div>
      <div className="flex gap-3">
        <Button variant="ghost" onClick={onPass}>
          Pass
        </Button>
        <Button variant="primary" onClick={onInterested}>
          Interested
        </Button>
      </div>
    </div>
  );
}

export interface WhyChipRowViewProps {
  note: string;
  onChipSelect: (chip: string) => void;
  onNoteChange: (note: string) => void;
  onSubmitNow: () => void;
}

/** The one-beat why-chip row: 6 canned one-worders + a 24-char free field, all optional. */
export function WhyChipRowView({ note, onChipSelect, onNoteChange, onSubmitNow }: WhyChipRowViewProps) {
  return (
    <div className="message-enter flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {WHY_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onChipSelect(chip)}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition-colors hover:border-amber hover:text-ink"
          >
            {chip}
          </button>
        ))}
      </div>
      <input
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmitNow();
        }}
        maxLength={WHY_FREE_TEXT_MAX}
        placeholder="one word why (optional)"
        className="rounded border border-line bg-transparent px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
      />
    </div>
  );
}

export interface ReactionDeckProps {
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}

/**
 * V3A_DESIGN.md §1.3 — the reaction calibration module. Owns its own
 * fetch/submit lifecycle: loads 6-8 sampled postings on mount, POSTs each
 * choice (bundled with the optional why-note) as one call, and self-
 * completes once the server reports `complete: true` (>=6 reactions) —
 * `onComplete` fires after the current card's why-beat finishes so the
 * user always sees the beat they just triggered.
 */
export function ReactionDeck({ onComplete, fetchImpl = fetch }: ReactionDeckProps) {
  const [state, dispatch] = useReducer(reactionDeckReducer, initialReactionDeckState);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReactionPostings(fetchImpl)
      .then((postings) => {
        if (!cancelled) dispatch({ type: "postings_loaded", postings });
      })
      .catch((err) => {
        if (!cancelled) dispatch({ type: "postings_load_failed", error: err instanceof Error ? err.message : "failed" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.phase === "finished") onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const currentPosting = state.postings[state.index];

  async function commitWhy(note: string) {
    if (!currentPosting || !state.pendingReaction || state.phase === "submitting") return;
    dispatch({ type: "submit_started" });
    try {
      const result = await submitReaction(currentPosting.id, state.pendingReaction, note, fetchImpl);
      dispatch({ type: "submit_succeeded", reactionCount: result.reaction_count, complete: result.complete });
      dispatch({ type: "card_advanced" });
    } catch (err) {
      dispatch({ type: "submit_failed", error: err instanceof Error ? err.message : "failed" });
    }
  }

  useEffect(() => {
    if (state.phase !== "why") return undefined;
    autoAdvanceTimer.current = setTimeout(() => {
      void commitWhy(state.note);
    }, WHY_AUTO_ADVANCE_MS);
    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.index]);

  useEffect(() => {
    if (state.phase !== "card") return undefined;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") dispatch({ type: "choice_made", reaction: "not_interested" });
      if (e.key === "ArrowRight") dispatch({ type: "choice_made", reaction: "interested" });
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [state.phase]);

  if (state.phase === "loading") return <div className="text-sm text-ink-muted">Loading real postings…</div>;
  if (state.phase === "error") return <div className="text-sm text-danger">{state.error}</div>;
  if (state.phase === "finished") return null;
  if (!currentPosting) return null;

  if (state.phase === "why" || state.phase === "submitting") {
    return (
      <WhyChipRowView
        note={state.note}
        onChipSelect={(chip) => void commitWhy(chip)}
        onNoteChange={(note) => dispatch({ type: "note_changed", note })}
        onSubmitNow={() => void commitWhy(state.note)}
      />
    );
  }

  return (
    <ReactionCardView
      posting={currentPosting}
      nextPosting={state.postings[state.index + 1]}
      position={state.index + 1}
      total={state.postings.length}
      canUndo={state.index > 0}
      onPass={() => dispatch({ type: "choice_made", reaction: "not_interested" })}
      onInterested={() => dispatch({ type: "choice_made", reaction: "interested" })}
      onUndo={() => dispatch({ type: "undo" })}
    />
  );
}
