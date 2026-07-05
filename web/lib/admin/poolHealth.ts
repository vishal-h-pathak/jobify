import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/** Mirrors `jobify.config.HOSTED_GLOBAL_MONTHLY_CAP_USD`'s own fallback. */
const DEFAULT_GLOBAL_CAP_USD = 100;

export interface PoolHealth {
  postingsCount: number;
  newestLastSeenAt: string | null;
  poolSpendUsdMtd: number;
  byoSpendUsdMtd: number;
  globalCapUsd: number;
}

/**
 * Read-only pool-health snapshot for the admin panel: postings volume +
 * freshness, and this month's pool-vs-BYO spend split against the global
 * cap. Mirrors `jobify.db.get_global_month_to_date_spend`'s client-side
 * sum (no `GROUP BY` via the Supabase JS client).
 */
export async function getPoolHealth(admin: SupabaseClient<Database>): Promise<PoolHealth> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();

  const [countRes, newestRes, ledgerRes] = await Promise.all([
    admin.from("postings").select("id", { count: "exact", head: true }),
    admin.from("postings").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("budget_ledger").select("cost_usd, byo").gte("created_at", monthStartIso),
  ]);
  if (countRes.error) throw countRes.error;
  if (newestRes.error) throw newestRes.error;
  if (ledgerRes.error) throw ledgerRes.error;

  let poolSpendUsdMtd = 0;
  let byoSpendUsdMtd = 0;
  for (const row of ledgerRes.data ?? []) {
    const cost = Number(row.cost_usd ?? 0);
    if (row.byo) byoSpendUsdMtd += cost;
    else poolSpendUsdMtd += cost;
  }

  return {
    postingsCount: countRes.count ?? 0,
    newestLastSeenAt: newestRes.data?.last_seen_at ?? null,
    poolSpendUsdMtd,
    byoSpendUsdMtd,
    globalCapUsd: Number(process.env.HOSTED_GLOBAL_MONTHLY_CAP_USD || DEFAULT_GLOBAL_CAP_USD),
  };
}
