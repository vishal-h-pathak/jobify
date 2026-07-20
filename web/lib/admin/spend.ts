import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export interface DailySpend {
  /** UTC calendar date, `YYYY-MM-DD`. */
  date: string;
  costUsd: number;
}

export interface UserSpend {
  userId: string;
  costUsd: number;
}

export interface SpendOverview {
  allTimeTotalUsd: number;
  /** All-time, grouped by `budget_ledger.event` — the ledger's own verb/kind
   * values (e.g. `onboarding_turn`, `embedding`, `llm_verdict`,
   * `rubric_compile`) since no separate "verb" column exists. */
  byEvent: Record<string, number>;
  byUser: UserSpend[];
  /** Last 14 UTC calendar days including today, oldest first, zero-filled
   * for days with no ledger rows so the admin table never skips a day. */
  last14Days: DailySpend[];
}

function emptySpendOverview(last14Days: DailySpend[]): SpendOverview {
  return { allTimeTotalUsd: 0, byEvent: {}, byUser: [], last14Days };
}

function last14DayKeys(now: Date): string[] {
  const keys: string[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * Pure aggregation over raw `budget_ledger` rows — all-time total, all-time
 * per-event and per-user totals, and a zero-filled last-14-UTC-days daily
 * table. Split out from the query below so the grouping math is unit
 * testable against fixture rows without a database (same convention as
 * `systemMetrics.ts::aggregateLedgerCosts`).
 */
export function aggregateSpendOverview(
  rows: Array<{ user_id: string; event: string; cost_usd: number | string | null; created_at: string }>,
  now: Date = new Date()
): SpendOverview {
  const dayKeys = last14DayKeys(now);
  const overview = emptySpendOverview(dayKeys.map((date) => ({ date, costUsd: 0 })));
  const dailyByKey = new Map(overview.last14Days.map((d) => [d.date, d]));
  const byUser = new Map<string, number>();

  for (const row of rows) {
    const cost = Number(row.cost_usd ?? 0);
    overview.allTimeTotalUsd += cost;
    overview.byEvent[row.event] = (overview.byEvent[row.event] ?? 0) + cost;
    byUser.set(row.user_id, (byUser.get(row.user_id) ?? 0) + cost);

    const dayKey = row.created_at.slice(0, 10);
    const bucket = dailyByKey.get(dayKey);
    if (bucket) bucket.costUsd += cost;
  }

  overview.byUser = Array.from(byUser.entries()).map(([userId, costUsd]) => ({ userId, costUsd }));
  return overview;
}

/** All-time `budget_ledger` rows, aggregated for the admin Spend card. One
 * full-table read — acceptable at this app's current scale (a handful of
 * friends), same convention as `poolHealth.ts`'s unfiltered reads. */
export async function getSpendOverview(admin: SupabaseClient<Database>, now: Date = new Date()): Promise<SpendOverview> {
  const { data, error } = await admin.from("budget_ledger").select("user_id, event, cost_usd, created_at");
  if (error) throw error;
  return aggregateSpendOverview(data ?? [], now);
}
