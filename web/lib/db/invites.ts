import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

/**
 * Attempts to claim an invite code for `userId`. Relies on the RLS policy
 * (`invites_claim_unclaimed`: `USING (claimed_by IS NULL) WITH CHECK
 * (claimed_by = auth.uid())`) as the source of truth — the explicit
 * `.is("claimed_by", null)` filter below just gives a clean "zero rows"
 * result on failure rather than depending solely on RLS silently no-op'ing
 * the update. Zero rows updated means invalid or already-claimed code;
 * this function never distinguishes the two (an unclaimed-code SELECT
 * policy would let a user enumerate valid codes — see 0003's header
 * comment).
 */
export async function claimInvite(
  supabase: SupabaseClient<Database>,
  code: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("invites")
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq("code", code)
    .is("claimed_by", null)
    .select("code");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** True if the signed-in user (via RLS) holds a claimed invite. */
export async function hasClaimedInvite(supabase: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await supabase.from("invites").select("code").limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
