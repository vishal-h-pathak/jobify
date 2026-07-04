"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  bestScore,
  dismissMatch,
  markApplied,
  runOptimisticTransition,
  saveMatch,
  undismissMatch,
  type MatchRow,
  type MatchWithPosting,
} from "@/lib/db/matches";

function relativeTime(iso: string): string {
  const diffMs = Date.parse(iso) - Date.now();
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (Math.abs(diffDays) >= 1) return rtf.format(diffDays, "day");
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  return rtf.format(diffHours, "hour");
}

function scoreLabel(score: number | null): string {
  return score === null ? "unscored" : `${Math.round(score * 100)}%`;
}

export function MatchCard({ match }: { match: MatchWithPosting }) {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [state, setState] = useState<MatchRow["state"]>(match.state);
  const [error, setError] = useState<string | null>(null);

  async function transition(next: MatchRow["state"], commit: () => Promise<void>) {
    setError(null);
    const result = await runOptimisticTransition<MatchRow["state"]>({
      apply: () => {
        const prev = state;
        setState(next);
        return prev;
      },
      revert: (prev) => setState(prev),
      commit,
    });
    if (!result.ok) setError(result.error);
  }

  const url = match.posting.application_url ?? (match.posting.raw?.url as string | undefined);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{match.posting.title ?? "Untitled role"}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {match.posting.company ?? "Unknown company"} ·{" "}
            {match.posting.remote ? "Remote" : match.posting.location ?? "Location unknown"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium dark:bg-zinc-800">
          {scoreLabel(bestScore(match))}
        </span>
      </div>

      {match.reason && (
        <p
          className={
            match.reason_source === "llm" ? "text-sm font-medium" : "text-sm text-zinc-500 dark:text-zinc-400"
          }
        >
          {match.reason}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
        <span>First seen {relativeTime(match.posting.first_seen_at)}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="font-medium underline">
            View posting
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {state === "dismissed" ? (
          <button
            onClick={() => transition("seen", () => undismissMatch(supabase, match.user_id, match.posting_id))}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
          >
            Undo
          </button>
        ) : (
          <>
            {state !== "saved" && state !== "applied" && (
              <button
                onClick={() => transition("saved", () => saveMatch(supabase, match.user_id, match.posting_id))}
                className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              >
                Save
              </button>
            )}
            {state !== "applied" && (
              <button
                onClick={() => transition("dismissed", () => dismissMatch(supabase, match.user_id, match.posting_id))}
                className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              >
                Dismiss
              </button>
            )}
            {state !== "applied" && (
              <button
                onClick={() => transition("applied", () => markApplied(supabase, match.user_id, match.posting_id))}
                className="rounded-md bg-foreground px-3 py-1 text-sm font-medium text-background"
              >
                I applied
              </button>
            )}
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
