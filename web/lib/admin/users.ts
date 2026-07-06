import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { BadgeTone } from "@/components/ui/Badge";

/** Shared by the admin Users table and its profile-review expander. */
export function validationTone(status: string | null): BadgeTone {
  if (status === "valid") return "success";
  if (status === "invalid") return "danger";
  return "neutral";
}

/**
 * Every auth user's id -> email, paginating past `listUsers()`'s default
 * 50-per-page cap so nobody silently drops off the panel once the friend
 * group grows. Service-role only — this is the one place in the app that
 * calls `auth.admin.*`.
 */
export async function listAllUserEmails(admin: SupabaseClient<Database>): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) emails.set(user.id, user.email);
    }
    if (data.users.length < perPage) break;
  }
  return emails;
}

export interface MatchCounts {
  new: number;
  seen: number;
  saved: number;
  dismissed: number;
  applied: number;
}

function emptyMatchCounts(): MatchCounts {
  return { new: 0, seen: 0, saved: 0, dismissed: 0, applied: 0 };
}

export interface UserOverviewRow {
  userId: string;
  email: string;
  validationStatus: string | null;
  matchCounts: MatchCounts;
  spendUsdMtd: number;
  hasByoKey: boolean;
}

/**
 * One row per `profiles`-eligible user for the admin Users card. Four
 * service-role reads run in parallel, each a single unfiltered/lightly-
 * filtered query grouped client-side (this codebase's existing convention
 * — see jobify.db.get_month_to_date_spend / lib/db/matches.ts's
 * groupMatches — the Supabase JS client has no `GROUP BY`).
 */
export async function listUsersOverview(
  admin: SupabaseClient<Database>,
  emailsByUserId: Map<string, string>
): Promise<UserOverviewRow[]> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();

  const [profilesRes, matchesRes, ledgerRes, keysRes] = await Promise.all([
    admin.from("profiles").select("user_id, validation_status"),
    admin.from("matches").select("user_id, state"),
    admin.from("budget_ledger").select("user_id, cost_usd").eq("byo", false).gte("created_at", monthStartIso),
    admin.from("api_keys").select("user_id"),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (matchesRes.error) throw matchesRes.error;
  if (ledgerRes.error) throw ledgerRes.error;
  if (keysRes.error) throw keysRes.error;

  const validationByUser = new Map<string, string | null>(
    (profilesRes.data ?? []).map((row) => [row.user_id, row.validation_status?.status ?? null])
  );

  const matchCountsByUser = new Map<string, MatchCounts>();
  for (const row of matchesRes.data ?? []) {
    const counts = matchCountsByUser.get(row.user_id) ?? emptyMatchCounts();
    counts[row.state] += 1;
    matchCountsByUser.set(row.user_id, counts);
  }

  const spendByUser = new Map<string, number>();
  for (const row of ledgerRes.data ?? []) {
    spendByUser.set(row.user_id, (spendByUser.get(row.user_id) ?? 0) + Number(row.cost_usd ?? 0));
  }

  const byoUserIds = new Set((keysRes.data ?? []).map((row) => row.user_id));

  return Array.from(emailsByUserId.entries()).map(([userId, email]) => ({
    userId,
    email,
    validationStatus: validationByUser.get(userId) ?? null,
    matchCounts: matchCountsByUser.get(userId) ?? emptyMatchCounts(),
    spendUsdMtd: spendByUser.get(userId) ?? 0,
    hasByoKey: byoUserIds.has(userId),
  }));
}
