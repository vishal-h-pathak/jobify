import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export interface HuntCycleRow {
  id: number;
  startedAt: string;
  mode: string;
  triggeredBy: string | null;
  usersScored: number;
  postingsUpserted: number;
  stage4Calls: number;
  costUsd: number;
  error: string | null;
}

/**
 * Last 15 `hunt_cycles` rows, newest first, for the admin System page's
 * "recent cycles" table. `stage4Calls` is pulled out of that row's own
 * `counters` JSONB rather than a dedicated column (see
 * jobify/hosted/fanout.py's `run_fanout_cycle` counters dict).
 */
export async function listRecentHuntCycles(admin: SupabaseClient<Database>): Promise<HuntCycleRow[]> {
  const { data, error } = await admin
    .from("hunt_cycles")
    .select("id, started_at, mode, triggered_by, users_scored, postings_upserted, counters, cost_usd, error")
    .order("started_at", { ascending: false })
    .limit(15);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    mode: row.mode,
    triggeredBy: row.triggered_by,
    usersScored: row.users_scored,
    postingsUpserted: row.postings_upserted,
    stage4Calls: Number(row.counters?.stage4_calls ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    error: row.error,
  }));
}

export interface FunnelStage {
  label: string;
  count: number;
}

/**
 * The five scoring-ladder stages, in the exact order the ADM-2 spec calls
 * for: postings considered -> passed title filter -> rubric-scored ->
 * embedded -> LLM verdicts. Keys mirror `jobify.hosted.fanout`'s counters
 * dict (`postings_scored` IS "rubric-scored" — the count of postings that
 * reached stage 2; `stage4_calls` IS "LLM verdicts").
 */
const FUNNEL_STAGES: Array<{ key: string; label: string }> = [
  { key: "postings_considered", label: "Postings considered" },
  { key: "passed_title_filter", label: "Passed title filter" },
  { key: "postings_scored", label: "Rubric-scored" },
  { key: "embedded", label: "Embedded" },
  { key: "stage4_calls", label: "LLM verdicts" },
];

/**
 * Pure aggregation, split out from the query below so the funnel's stage
 * order + key-mapping can be unit tested directly against a fixture
 * `counters` dict without a database.
 */
export function buildFunnelFromCounters(counters: Record<string, number> | null): FunnelStage[] {
  return FUNNEL_STAGES.map(({ key, label }) => ({ label, count: Number(counters?.[key] ?? 0) }));
}

/**
 * The most recent scoring cycle's funnel (mode !== 'discovery_only', since
 * a discovery-only cycle never ran fan-out and its counters are all
 * legitimately zero). Null when no scoring cycle has run yet.
 */
export async function getMostRecentScoringFunnel(admin: SupabaseClient<Database>): Promise<FunnelStage[] | null> {
  const { data, error } = await admin
    .from("hunt_cycles")
    .select("counters")
    .neq("mode", "discovery_only")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return buildFunnelFromCounters(data.counters);
}
