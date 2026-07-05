import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

function monthStartIso(): string {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return monthStart.toISOString();
}

export interface CostBreakdown {
  byEvent: Record<string, number>;
  byModel: Record<string, number>;
  poolUsd: number;
  byoUsd: number;
}

function emptyCostBreakdown(): CostBreakdown {
  return { byEvent: {}, byModel: {}, poolUsd: 0, byoUsd: 0 };
}

/**
 * Pure grouping over raw `budget_ledger` rows — by `event`, by `model`,
 * and pool-vs-BYO — split out from the query below so the grouping math
 * can be unit tested against fixture rows without a database (same
 * client-side `GROUP BY` convention as `poolHealth.ts`'s pool/BYO split).
 */
export function aggregateLedgerCosts(
  rows: Array<{ event: string; model: string | null; cost_usd: number | string | null; byo: boolean }>
): CostBreakdown {
  const breakdown = emptyCostBreakdown();
  for (const row of rows) {
    const cost = Number(row.cost_usd ?? 0);
    breakdown.byEvent[row.event] = (breakdown.byEvent[row.event] ?? 0) + cost;
    const modelKey = row.model ?? "(no model)";
    breakdown.byModel[modelKey] = (breakdown.byModel[modelKey] ?? 0) + cost;
    if (row.byo) breakdown.byoUsd += cost;
    else breakdown.poolUsd += cost;
  }
  return breakdown;
}

/** This month's `budget_ledger` rows, grouped by event / model / pool-vs-BYO. */
export async function getCostBreakdownMtd(admin: SupabaseClient<Database>): Promise<CostBreakdown> {
  const { data, error } = await admin
    .from("budget_ledger")
    .select("event, model, cost_usd, byo")
    .gte("created_at", monthStartIso());
  if (error) throw error;
  return aggregateLedgerCosts(data ?? []);
}

export type MatchState = "new" | "seen" | "saved" | "dismissed" | "applied";

function emptyStateCounts(): Record<MatchState, number> {
  return { new: 0, seen: 0, saved: 0, dismissed: 0, applied: 0 };
}

export interface AppliedByUser {
  userId: string;
  count: number;
}

export interface EngagementSnapshot {
  totalsByState: Record<MatchState, number>;
  last7DaysByState: Record<MatchState, number>;
  /** `saved / dismissed`, or null when `dismissed` is 0 (render "—", not Infinity/NaN). */
  savesToDismissalsRatio: number | null;
  appliedByUser: AppliedByUser[];
}

/**
 * Pure aggregation over raw `matches` rows — all-time + last-7-days totals
 * by state, the saves:dismissals ratio, and per-user applied counts.
 * `now` is injectable so the 7-day window is testable without mocking the
 * system clock.
 */
export function aggregateEngagement(
  rows: Array<{ user_id: string; state: MatchState; state_changed_at: string }>,
  now: Date = new Date()
): EngagementSnapshot {
  const totalsByState = emptyStateCounts();
  const last7DaysByState = emptyStateCounts();
  const sevenDaysAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const appliedCounts = new Map<string, number>();

  for (const row of rows) {
    totalsByState[row.state] += 1;
    if (new Date(row.state_changed_at).getTime() >= sevenDaysAgoMs) {
      last7DaysByState[row.state] += 1;
    }
    if (row.state === "applied") {
      appliedCounts.set(row.user_id, (appliedCounts.get(row.user_id) ?? 0) + 1);
    }
  }

  return {
    totalsByState,
    last7DaysByState,
    savesToDismissalsRatio: totalsByState.dismissed > 0 ? totalsByState.saved / totalsByState.dismissed : null,
    appliedByUser: Array.from(appliedCounts.entries()).map(([userId, count]) => ({ userId, count })),
  };
}

/** Every `matches` row's state + timestamps, aggregated for the admin System page's engagement card. */
export async function getEngagementSnapshot(admin: SupabaseClient<Database>): Promise<EngagementSnapshot> {
  const { data, error } = await admin.from("matches").select("user_id, state, state_changed_at");
  if (error) throw error;
  return aggregateEngagement(data ?? []);
}

export interface PoolFreshness {
  postingsCount: number;
  newestLastSeenAt: string | null;
  oldestLastSeenAt: string | null;
  expiredCount: number;
}

/**
 * Pool freshness snapshot for the admin System page: postings volume,
 * newest/oldest `last_seen_at`, and how many are marked `link_status =
 * 'expired'`. Kept as its own function (rather than extending
 * `getPoolHealth`) so `poolHealth.test.ts`'s existing assertions stay
 * untouched — this is a superset of two of that function's queries, but
 * duplicating a couple of cheap reads is cheaper than risking that file.
 */
export async function getPoolFreshness(admin: SupabaseClient<Database>): Promise<PoolFreshness> {
  const [countRes, newestRes, oldestRes, expiredRes] = await Promise.all([
    admin.from("postings").select("id", { count: "exact", head: true }),
    admin.from("postings").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("postings").select("last_seen_at").order("last_seen_at", { ascending: true }).limit(1).maybeSingle(),
    admin.from("postings").select("id", { count: "exact", head: true }).eq("link_status", "expired"),
  ]);
  if (countRes.error) throw countRes.error;
  if (newestRes.error) throw newestRes.error;
  if (oldestRes.error) throw oldestRes.error;
  if (expiredRes.error) throw expiredRes.error;

  return {
    postingsCount: countRes.count ?? 0,
    newestLastSeenAt: newestRes.data?.last_seen_at ?? null,
    oldestLastSeenAt: oldestRes.data?.last_seen_at ?? null,
    expiredCount: expiredRes.count ?? 0,
  };
}
