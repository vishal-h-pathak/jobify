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
  params: { userId: string; model: string; inputTokens: number; outputTokens: number }
): Promise<void> {
  const { userId, model, inputTokens, outputTokens } = params;
  const { error } = await admin.from("budget_ledger").insert({
    user_id: userId,
    event: "onboarding_turn",
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: computeCostUsd(model, inputTokens, outputTokens),
  });
  if (error) throw error;
}
