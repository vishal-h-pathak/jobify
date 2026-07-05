import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Matches the shape `jobify.hosted.invites.mint_invites` produces
 * (`secrets.token_urlsafe(9).lower()`): 9 random bytes, base64url-encoded
 * (12 chars, no padding — 9 bytes is an exact multiple of the base64
 * 3-byte group), lowercased for easy paste-and-type.
 */
export function generateInviteCode(): string {
  return crypto.randomBytes(9).toString("base64url").toLowerCase();
}

/** Mint `n` fresh invite codes via the service-role client and return them. */
export async function mintInvites(admin: SupabaseClient<Database>, n: number): Promise<string[]> {
  const codes = Array.from({ length: n }, generateInviteCode);
  const { error } = await admin.from("invites").insert(codes.map((code) => ({ code })));
  if (error) throw error;
  return codes;
}

export interface AdminInviteRow {
  code: string;
  createdAt: string;
  claimedByEmail: string | null;
  claimedAt: string | null;
}

/**
 * Every invite code, newest first, for the admin Invites card.
 * `claimed_by` is a bare user id — resolved to an email via the caller-
 * supplied map (built once per page load by `listAllUserEmails`) rather
 * than this function calling `auth.admin.listUsers()` a second time.
 */
export async function listInvitesForAdmin(
  admin: SupabaseClient<Database>,
  emailsByUserId: Map<string, string>
): Promise<AdminInviteRow[]> {
  const { data, error } = await admin
    .from("invites")
    .select("code, claimed_by, claimed_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    code: row.code,
    createdAt: row.created_at,
    claimedByEmail: row.claimed_by ? (emailsByUserId.get(row.claimed_by) ?? row.claimed_by) : null,
    claimedAt: row.claimed_at,
  }));
}
