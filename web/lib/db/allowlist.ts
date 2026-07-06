import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { mintInvites } from "@/lib/admin/invites";

/**
 * The auth callback's auto-claim hook (SGN-1): when a signed-in user holds
 * no claimed invite, check whether their email was pre-approved by the
 * operator (`allowed_emails`, service-role-only table, 0009). On a hit,
 * mint one invite (reusing the same generator/insert path as the admin
 * "Mint invite" button), claim it directly for this user via a service-role
 * UPDATE (not the user-facing `claim_invite` RPC — that runs under the
 * caller's own auth context and would fight the anti-enumeration SELECT
 * policy, see lib/db/invites.ts), then mark the allowlist row consumed.
 * This is "atomically-ish", not a single transaction — a crash between
 * steps can leave an orphaned unclaimed invite or a consumed row with no
 * claimed invite, both accepted as harmless (mirrors invites' own
 * over-minting-is-harmless posture). Any failure is swallowed to `false` so
 * the caller falls through to the normal `/invite` routing — never a dead
 * end, never a 500 on the callback.
 */
export async function consumeAllowlistedEmail(admin: SupabaseClient<Database>, user: User): Promise<boolean> {
  if (!user.email) return false;
  const email = user.email.toLowerCase();

  try {
    const { data: row, error: selectError } = await admin
      .from("allowed_emails")
      .select("email")
      .eq("email", email)
      .is("consumed_by", null)
      .maybeSingle();
    if (selectError) throw selectError;
    if (!row) return false; // no such email, or already consumed

    const [code] = await mintInvites(admin, 1);

    const { error: claimError } = await admin
      .from("invites")
      .update({ claimed_by: user.id, claimed_at: new Date().toISOString() })
      .eq("code", code);
    if (claimError) throw claimError;

    const { error: consumeError } = await admin
      .from("allowed_emails")
      .update({ consumed_by: user.id, consumed_at: new Date().toISOString() })
      .eq("email", email);
    if (consumeError) throw consumeError;

    return true;
  } catch (err) {
    console.error("consumeAllowlistedEmail: auto-claim failed, falling through to /invite", err);
    return false;
  }
}
