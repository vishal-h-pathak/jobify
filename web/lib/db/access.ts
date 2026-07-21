import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { hasClaimedInvite } from "@/lib/db/invites";
import { consumeAllowlistedEmail } from "@/lib/db/allowlist";
import { isAdmin } from "@/lib/admin/isAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The single account-level access predicate every gate (pages and API
 * routes alike) must call — unifies the two parallel grant paths that used
 * to be checked independently: a claimed invite code, and a pre-approved
 * `allowed_emails` row. Checking `hasClaimedInvite` alone (the pre-2026-07-21
 * pattern) left allowlisted users permanently locked out of any entry path
 * that skipped the auth callback's one-time auto-claim hop (e.g. arriving
 * via `/invite` with a `next` param) — the auto-claim never ran, so
 * `hasClaimedInvite` stayed false forever for that account. Calling
 * `consumeAllowlistedEmail` here instead of only in the callback makes the
 * auto-claim retry on every access check, from whichever gate happens to
 * run it first; it's idempotent (a no-op once the allowlist row is
 * consumed), so re-checking costs one wasted SELECT at worst.
 */
export async function hasAccess(supabase: SupabaseClient<Database>, user: User): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (await hasClaimedInvite(supabase)) return true;
  const admin = createSupabaseAdminClient();
  return consumeAllowlistedEmail(admin, user);
}
