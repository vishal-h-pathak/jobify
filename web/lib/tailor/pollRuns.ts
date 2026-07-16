import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

type TailorRunRow = Database["public"]["Tables"]["tailor_runs"]["Row"];

/**
 * What a poller needs, and no more: `user_id`/`posting_id` are already
 * known to the caller (it asked for this exact posting as this exact
 * signed-in user), and `doc_sha256` is an internal claims-verification
 * pin with no UI use yet per `V3B_DESIGN.md` §1.3/§2.1 — trimming it here
 * is slightly more honest about the response's purpose than echoing the
 * full row.
 */
export type PolledTailorRun = Pick<
  TailorRunRow,
  | "id"
  | "status"
  | "mode"
  | "template"
  | "feedback"
  | "progress"
  | "dropped_count"
  | "error"
  | "cost_usd"
  | "created_at"
  | "updated_at"
>;

export const STALE_REAP_ERROR = "runner never picked this up — try again";

export interface PollRunsDeps {
  admin: SupabaseClient<Database>;
  supabase: SupabaseClient<Database>;
  userId: string;
  postingId: string;
  now: () => Date;
  staleMinutes: number;
}

/**
 * Core logic behind `GET /api/tailor/runs`, factored out of the route
 * handler the same way `dispatchTailor.ts` is factored out of
 * `POST /api/tailor/run` — see `pollRuns.test.ts`. The route owns turning
 * the result into a `NextResponse`; this function never touches it.
 *
 * Client split (design doc §1.3's RLS comment: "own-row SELECT (polling).
 * INSERT/UPDATE service-role only"):
 *   - the **authed** `supabase` client does the SELECT — RLS already
 *     restricts it to the caller's own rows, so `userId`/`postingId` here
 *     are a belt-and-suspenders filter, not the only thing standing
 *     between users.
 *   - the **admin** client does the stale-reap UPDATE — RLS has no
 *     own-row UPDATE policy at all for this table, so the authed client
 *     could not perform it even scoped to the caller's own row.
 *
 * Staleness ("more than 10 minutes before now()", design doc §1.3, taken
 * literally): a `queued` row is stale when its age is *strictly greater
 * than* `staleMinutes`. A row exactly at the boundary (age === staleMinutes)
 * is therefore NOT reaped — chosen so a row can't flap to `failed` on a
 * poll that lands in the same instant the runner would have picked it up.
 * Only `status === "queued"` rows are ever candidates; `running` /
 * `succeeded` / `failed` are left untouched no matter how old.
 *
 * The reaped rows' `status`/`error`/`updated_at` are reflected directly in
 * the returned array so the caller sees the reap take effect on this same
 * response, without needing to re-poll.
 */
export async function pollRuns(deps: PollRunsDeps): Promise<{ runs: PolledTailorRun[] }> {
  const { admin, supabase, userId, postingId, now, staleMinutes } = deps;

  const { data, error } = await supabase
    .from("tailor_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("posting_id", postingId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  const nowDate = now();
  const nowMs = nowDate.getTime();
  const staleMs = staleMinutes * 60 * 1000;

  const staleIds = rows
    .filter((r) => r.status === "queued" && nowMs - new Date(r.created_at).getTime() > staleMs)
    .map((r) => r.id);

  if (staleIds.length > 0) {
    const { error: updateError } = await admin
      .from("tailor_runs")
      .update({ status: "failed", error: STALE_REAP_ERROR, updated_at: nowDate.toISOString() })
      .in("id", staleIds);
    if (updateError) throw updateError;
  }

  const staleIdSet = new Set(staleIds);
  const nowIso = nowDate.toISOString();

  const runs: PolledTailorRun[] = rows.map((r) => {
    const reaped = staleIdSet.has(r.id);
    return {
      id: r.id,
      status: reaped ? "failed" : r.status,
      mode: r.mode,
      template: r.template,
      feedback: r.feedback,
      progress: r.progress,
      dropped_count: r.dropped_count,
      error: reaped ? STALE_REAP_ERROR : r.error,
      cost_usd: r.cost_usd,
      created_at: r.created_at,
      updated_at: reaped ? nowIso : r.updated_at,
    };
  });

  return { runs };
}
