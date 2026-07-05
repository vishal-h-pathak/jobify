"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Badge, scoreTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
  const score = bestScore(match);

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-ink">{match.posting.title ?? "Untitled role"}</h3>
          <p className="text-sm text-ink-muted">
            {match.posting.company ?? "Unknown company"} ·{" "}
            {match.posting.remote ? "Remote" : match.posting.location ?? "Location unknown"}
          </p>
        </div>
        <Badge tone={scoreTone(score)}>{scoreLabel(score)}</Badge>
      </div>

      {match.reason && (
        <p className={match.reason_source === "llm" ? "text-sm font-medium text-ink" : "text-sm text-ink-muted"}>
          {match.reason}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
        <span>First seen {relativeTime(match.posting.first_seen_at)}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="font-medium text-amber underline">
            View posting
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {state === "dismissed" ? (
          <Button
            variant="ghost"
            onClick={() => transition("seen", () => undismissMatch(supabase, match.user_id, match.posting_id))}
          >
            Undo
          </Button>
        ) : (
          <>
            {state !== "saved" && state !== "applied" && (
              <Button
                variant="ghost"
                onClick={() => transition("saved", () => saveMatch(supabase, match.user_id, match.posting_id))}
              >
                Save
              </Button>
            )}
            {state !== "applied" && (
              <Button
                variant="ghost"
                onClick={() => transition("dismissed", () => dismissMatch(supabase, match.user_id, match.posting_id))}
              >
                Dismiss
              </Button>
            )}
            {state !== "applied" && (
              <Button
                variant="ghost"
                onClick={() => transition("applied", () => markApplied(supabase, match.user_id, match.posting_id))}
              >
                I applied
              </Button>
            )}
          </>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </Card>
  );
}
