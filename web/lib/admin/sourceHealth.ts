import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type SourceFunnelRow = Database["public"]["Views"]["source_funnel_rollup"]["Row"];

export interface SourceFunnelView {
  source: string | null;
  queryKey: string | null;
  boardId: string | null;
  boardCompanyName: string | null;
  boardStatus: string | null;
  postings60d: number;
  postings90d: number;
  surfaced60d: number;
  surfaced90d: number;
  usersEngaged60d: number;
  usersEngaged90d: number;
  /** Kill-rule flag (planning/HUNT2_SOURCES.md §5): a paid query
   * (`queryKey` populated) with zero surfaced matches in 60 days. Flag
   * only — nothing here spends budget; an operator acts on it out of
   * band. */
  rotate: boolean;
  /** Kill-rule flag: a catalog board (`boardId` populated) with zero
   * surfaced matches for any user in 90 days. Flag only — the admin
   * "Sources" card's dormant button is what actually sets the status. */
  dormantCandidate: boolean;
}

function toView(row: SourceFunnelRow): SourceFunnelView {
  const postings60d = row.postings_60d ?? 0;
  const postings90d = row.postings_90d ?? 0;
  const surfaced60d = row.surfaced_60d ?? 0;
  const surfaced90d = row.surfaced_90d ?? 0;
  return {
    source: row.source,
    queryKey: row.query_key,
    boardId: row.board_id,
    boardCompanyName: row.board_company_name,
    boardStatus: row.board_status,
    postings60d,
    postings90d,
    surfaced60d,
    surfaced90d,
    usersEngaged60d: row.users_engaged_60d ?? 0,
    usersEngaged90d: row.users_engaged_90d ?? 0,
    rotate: row.query_key !== null && surfaced60d === 0,
    dormantCandidate: row.board_id !== null && row.board_status === "active" && surfaced90d === 0,
  };
}

/**
 * HUNT2 P3 S6: the admin "Sources" card's read surface over
 * `source_funnel_rollup` (0018) — one row per (source, paid-query,
 * catalog board), each already carrying both 60d/90d rolling counts
 * (the view's own FILTER-clause columns, evaluated live against `now()`
 * on every SELECT). Rows with neither a nonzero `postings60d`/`90d` nor
 * an engaged user are still returned — a paid query or board with truly
 * zero activity in even the 90-day window is exactly the signal the
 * kill rules exist to surface, not something to hide.
 */
export async function getSourceFunnel(admin: SupabaseClient<Database>): Promise<SourceFunnelView[]> {
  const { data, error } = await admin
    .from("source_funnel_rollup")
    .select("*")
    .order("postings_90d", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toView);
}

export type SetDormantResult = { kind: "ok" } | { kind: "not_found" } | { kind: "not_active" };

/**
 * Admin-only action: flip a `board_catalog` row to `'dormant'` —
 * NEVER done automatically (`dormantCandidate` above is a flag, not a
 * trigger). Dormant boards are excluded from tier packs
 * (`seedUserPortals.ts` filters on `status = 'active'` when reading the
 * catalog) but still cheap-fetched by discovery/board_health — dormant
 * ≠ deleted.
 */
export async function setBoardDormant(admin: SupabaseClient<Database>, boardId: string): Promise<SetDormantResult> {
  const { data: row, error: readError } = await admin
    .from("board_catalog")
    .select("status")
    .eq("id", boardId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) return { kind: "not_found" };
  if (row.status !== "active") return { kind: "not_active" };

  const { error } = await admin.from("board_catalog").update({ status: "dormant" }).eq("id", boardId);
  if (error) throw error;
  return { kind: "ok" };
}
