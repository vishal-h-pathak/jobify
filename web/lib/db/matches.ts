import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `matches`/`postings` row shapes. The app-wide `web/lib/supabase/types.ts`
 * Database interface doesn't have these two tables yet — that's a shared
 * file outside this session's ownership (see 14_h5_feed_ui.md's file
 * boundaries), so rather than editing it this module works against an
 * untyped `SupabaseClient` (any caller's `SupabaseClient<Database>` is
 * structurally assignable to it) and casts query results to the row
 * shapes below itself. Flagged for the merge reviewer to fold `matches`/
 * `postings` into the canonical `Database` so this can go back to a
 * fully generic-typed client.
 */
export type FeedSupabaseClient = SupabaseClient;

export interface MatchRow {
  user_id: string;
  posting_id: string;
  rubric_score: number | null;
  embed_score: number | null;
  llm_score: number | null;
  reason: string | null;
  reason_source: "llm" | "rubric" | null;
  state: "new" | "seen" | "saved" | "dismissed" | "applied";
  state_changed_at: string;
  created_at: string;
}

export interface PostingRow {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  remote: boolean | null;
  application_url: string | null;
  ats_kind: string | null;
  first_seen_at: string;
  raw: Record<string, unknown> | null;
}

export type MatchWithPosting = MatchRow & { posting: PostingRow };

/** llm_score > embed_score > rubric_score, first non-null wins. */
export function bestScore(m: Pick<MatchRow, "llm_score" | "embed_score" | "rubric_score">): number | null {
  return m.llm_score ?? m.embed_score ?? m.rubric_score ?? null;
}

/** Descending by bestScore; matches with no score at all sort last. */
export function sortByBestScore<T extends Pick<MatchRow, "llm_score" | "embed_score" | "rubric_score">>(
  matches: T[]
): T[] {
  return [...matches].sort((a, b) => {
    const scoreA = bestScore(a);
    const scoreB = bestScore(b);
    if (scoreA === null && scoreB === null) return 0;
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    return scoreB - scoreA;
  });
}

export interface GroupedMatches<T> {
  new: T[];
  saved: T[];
  applied: T[];
  dismissed: T[];
}

/** `new` + `seen` states merge into the `new` bucket. */
export function groupMatches<T extends Pick<MatchRow, "state">>(matches: T[]): GroupedMatches<T> {
  const grouped: GroupedMatches<T> = { new: [], saved: [], applied: [], dismissed: [] };
  for (const m of matches) {
    if (m.state === "new" || m.state === "seen") grouped.new.push(m);
    else if (m.state === "saved") grouped.saved.push(m);
    else if (m.state === "applied") grouped.applied.push(m);
    else if (m.state === "dismissed") grouped.dismissed.push(m);
  }
  return grouped;
}

async function assertRowsAffected(
  supabase: FeedSupabaseClient,
  postingId: string,
  newState: MatchRow["state"]
): Promise<void> {
  const { data, error } = await supabase
    .from("matches")
    .update({ state: newState, state_changed_at: new Date().toISOString() })
    .eq("posting_id", postingId)
    .select("posting_id");
  if (error) throw error;
  const rows = data as Array<{ posting_id: string }> | null;
  if (!rows || rows.length === 0) {
    throw new Error(
      `match state update to '${newState}' affected 0 rows (posting ${postingId}) — RLS policy regression?`
    );
  }
}

/**
 * Bulk `new -> seen`, batched into one UPDATE. Idempotent and silent on
 * zero rows affected (already-seen cards re-render every load) — unlike
 * the single-row transitions below, this is NOT the RLS-regression signal
 * the review note calls out; it's just "nothing left to mark."
 */
export async function markSeenBulk(supabase: FeedSupabaseClient, postingIds: string[]): Promise<void> {
  if (postingIds.length === 0) return;
  const { error } = await supabase
    .from("matches")
    .update({ state: "seen", state_changed_at: new Date().toISOString() })
    .eq("state", "new")
    .in("posting_id", postingIds);
  if (error) throw error;
}

export async function saveMatch(supabase: FeedSupabaseClient, postingId: string): Promise<void> {
  await assertRowsAffected(supabase, postingId, "saved");
}

export async function dismissMatch(supabase: FeedSupabaseClient, postingId: string): Promise<void> {
  await assertRowsAffected(supabase, postingId, "dismissed");
}

/** No prior state is stored on the row, so undo lands on `seen` (already seen, not brand new). */
export async function undismissMatch(supabase: FeedSupabaseClient, postingId: string): Promise<void> {
  await assertRowsAffected(supabase, postingId, "seen");
}

/** "I applied" is always an explicit human click — never called automatically. */
export async function markApplied(supabase: FeedSupabaseClient, postingId: string): Promise<void> {
  await assertRowsAffected(supabase, postingId, "applied");
}

/**
 * Optimistic UI seam: apply a local state change synchronously, commit it
 * to the server, and revert the local change if the commit throws. Kept
 * framework-agnostic (no React) so it's testable as a plain function.
 */
export async function runOptimisticTransition<T>(params: {
  apply: () => T;
  revert: (snapshot: T) => void;
  commit: () => Promise<void>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const snapshot = params.apply();
  try {
    await params.commit();
    return { ok: true };
  } catch (err) {
    params.revert(snapshot);
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
