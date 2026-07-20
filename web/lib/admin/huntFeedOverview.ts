import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type MatchFunnelStatus = "rejected_title" | "rejected_rubric" | "rejected_rerank" | "rejected_llm" | "surfaced";

const FUNNEL_STATUSES: readonly MatchFunnelStatus[] = [
  "rejected_title",
  "rejected_rubric",
  "rejected_rerank",
  "rejected_llm",
  "surfaced",
];

export interface UserHuntFeedRow {
  userId: string;
  byStatus: Record<MatchFunnelStatus, number>;
  /** Location-tier distribution of `surfaced` matches only — tier 1/2/3
   * mirror `matches.location_tier` (HUNT2 session 47), `unknown` covers
   * `location_tier IS NULL` (a surfaced posting the ranker never tiered). */
  surfacedLocationTiers: { tier1: number; tier2: number; tier3: number; unknown: number };
}

function emptyFunnelCounts(): Record<MatchFunnelStatus, number> {
  return { rejected_title: 0, rejected_rubric: 0, rejected_rerank: 0, rejected_llm: 0, surfaced: 0 };
}

export function emptyHuntFeedRow(userId: string): UserHuntFeedRow {
  return { userId, byStatus: emptyFunnelCounts(), surfacedLocationTiers: { tier1: 0, tier2: 0, tier3: 0, unknown: 0 } };
}

/**
 * Pure aggregation over raw `matches` rows, per user — split out from the
 * query below so the funnel/tier grouping is unit testable without a
 * database (same convention as `spend.ts`/`systemMetrics.ts`).
 */
export function aggregateHuntFeedOverview(
  rows: Array<{ user_id: string; status: MatchFunnelStatus; location_tier: 1 | 2 | 3 | null }>
): Map<string, UserHuntFeedRow> {
  const byUser = new Map<string, UserHuntFeedRow>();
  for (const row of rows) {
    const entry = byUser.get(row.user_id) ?? emptyHuntFeedRow(row.user_id);
    entry.byStatus[row.status] += 1;
    if (row.status === "surfaced") {
      if (row.location_tier === 1) entry.surfacedLocationTiers.tier1 += 1;
      else if (row.location_tier === 2) entry.surfacedLocationTiers.tier2 += 1;
      else if (row.location_tier === 3) entry.surfacedLocationTiers.tier3 += 1;
      else entry.surfacedLocationTiers.unknown += 1;
    }
    byUser.set(row.user_id, entry);
  }
  return byUser;
}

/** Every user's matches funnel + surfaced location-tier distribution, for
 * the admin "Hunt & feed" per-user section. `hunt_cycles` carries no
 * `user_id` column (only `single_user` cycles target one user, and that
 * target lives only in the dispatched workflow input, not the row) so it
 * can't be joined in per-user here — the admin System page's existing
 * "Recent hunt cycles" table stays the source for cycle-level data. */
export async function getHuntFeedOverview(admin: SupabaseClient<Database>): Promise<Map<string, UserHuntFeedRow>> {
  const { data, error } = await admin.from("matches").select("user_id, status, location_tier");
  if (error) throw error;
  return aggregateHuntFeedOverview((data ?? []) as Array<{ user_id: string; status: MatchFunnelStatus; location_tier: 1 | 2 | 3 | null }>);
}

export { FUNNEL_STATUSES };
