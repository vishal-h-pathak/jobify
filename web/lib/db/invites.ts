import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

/**
 * Attempts to claim an invite code for the signed-in user via the
 * `claim_invite` SECURITY DEFINER function (migration 0005). A direct
 * authed UPDATE can never work here: Postgres requires UPDATE-targeted
 * rows to also pass the SELECT policy when the WHERE reads table columns,
 * and the anti-enumeration SELECT policy hides unclaimed codes — found in
 * live RLS verification 2026-07-03. The function keeps both guarantees:
 * no code enumeration, atomic first-claimer-wins. `false` means invalid
 * or already-claimed code; callers never learn which.
 */
export async function claimInvite(
  supabase: SupabaseClient<Database>,
  code: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_invite", { invite_code: code });
  if (error) throw error;
  return data === true;
}

/** True if the signed-in user (via RLS) holds a claimed invite. */
export async function hasClaimedInvite(supabase: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await supabase.from("invites").select("code").limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
