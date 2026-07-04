import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type FeedSupabaseClient = SupabaseClient<Database>;

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
  description: string | null;
  application_url: string | null;
  ats_kind: string | null;
  link_status: string | null;
  source: string | null;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  embedding: number[] | null;
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
  userId: string,
  postingId: string,
  newState: MatchRow["state"]
): Promise<void> {
  const { data, error } = await supabase
    .from("matches")
    .update({ state: newState, state_changed_at: new Date().toISOString() })
    .eq("user_id", userId)
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
export async function markSeenBulk(supabase: FeedSupabaseClient, userId: string, postingIds: string[]): Promise<void> {
  if (postingIds.length === 0) return;
  const { error } = await supabase
    .from("matches")
    .update({ state: "seen", state_changed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("state", "new")
    .in("posting_id", postingIds);
  if (error) throw error;
}

export async function saveMatch(supabase: FeedSupabaseClient, userId: string, postingId: string): Promise<void> {
  await assertRowsAffected(supabase, userId, postingId, "saved");
}

export async function dismissMatch(supabase: FeedSupabaseClient, userId: string, postingId: string): Promise<void> {
  await assertRowsAffected(supabase, userId, postingId, "dismissed");
}

/** No prior state is stored on the row, so undo lands on `seen` (already seen, not brand new). */
export async function undismissMatch(supabase: FeedSupabaseClient, userId: string, postingId: string): Promise<void> {
  await assertRowsAffected(supabase, userId, postingId, "seen");
}

/** "I applied" is always an explicit human click — never called automatically. */
export async function markApplied(supabase: FeedSupabaseClient, userId: string, postingId: string): Promise<void> {
  await assertRowsAffected(supabase, userId, postingId, "applied");
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
