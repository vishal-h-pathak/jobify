import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { computeCostUsd } from "../anthropic/pricing";

/**
 * Records one `budget_ledger` row for an onboarding-chat turn. Per the H3
 * session prompt this is written "via service-role" (H6's contract) — call
 * with an admin client (`lib/supabase/admin.ts`), never the authed
 * request-scoped client.
 */
export async function recordOnboardingTurn(
  admin: SupabaseClient<Database>,
  params: { userId: string; model: string; inputTokens: number; outputTokens: number; event?: string }
): Promise<void> {
  const { userId, model, inputTokens, outputTokens, event = "onboarding_turn" } = params;
  const { error } = await admin.from("budget_ledger").insert({
    user_id: userId,
    event,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: computeCostUsd(model, inputTokens, outputTokens),
  });
  if (error) throw error;
}

/** Mirrors `jobify.db.DEFAULT_MONTHLY_USD_CAP` — a user with no `budget_caps`
 * row yet still gets a real cap, not zero (which would look pre-exceeded). */
export const DEFAULT_MONTHLY_USD_CAP = 5.0;

/**
 * Month-to-date pool spend for the settings page (H6). Mirrors
 * `jobify.db.get_month_to_date_spend` exactly: sums `cost_usd` since the
 * start of the current UTC calendar month, excluding `byo = true` rows —
 * a user's own-key spend never counts against their pool cap. Uses the
 * authed request-scoped client (own-row SELECT via RLS), not the admin
 * client — this is a read of the signed-in user's own data.
 */
export async function getMonthToDateSpend(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("budget_ledger")
    .select("cost_usd")
    .eq("user_id", userId)
    .eq("byo", false)
    .gte("created_at", monthStart.toISOString());
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
}

/** `user_id`'s `budget_caps.monthly_usd_cap`, or `DEFAULT_MONTHLY_USD_CAP`
 * when no row exists yet — mirrors `jobify.db.get_budget_cap`. */
export async function getBudgetCap(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("budget_caps")
    .select("monthly_usd_cap")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.monthly_usd_cap ?? DEFAULT_MONTHLY_USD_CAP;
}
