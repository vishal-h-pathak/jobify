import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

/**
 * UX1 pinned contract (session-prompts/43_ux1_gate.md, shared verbatim with
 * 44_*): the ONE completion source of truth. No other signal (profiles-row
 * existence, stage, etc.) means "done" — use this everywhere a page needs
 * to know whether the intake is finished.
 */
export async function intakeComplete(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("onboarding_sessions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.status === "complete";
}
