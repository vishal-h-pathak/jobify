import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

type SessionRow = Database["public"]["Tables"]["onboarding_sessions"]["Row"];

/**
 * Loads (or lazily creates) the caller's onboarding session row. This is
 * what makes the interview resumable: a dropped connection just re-reads
 * this row and re-renders `messages` — no restart. Uses the authed
 * request-scoped client so RLS's own-row policy applies.
 */
export async function getOrCreateSession(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<SessionRow> {
  const { data: existing, error: selectError } = await supabase
    .from("onboarding_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("onboarding_sessions")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return created;
}

export async function saveSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  updates: Database["public"]["Tables"]["onboarding_sessions"]["Update"]
): Promise<void> {
  const { error } = await supabase
    .from("onboarding_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
}
