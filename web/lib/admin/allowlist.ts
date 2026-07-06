import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Loose shape check (not a deliverability check) — same bar as looksLikeAnthropicKey elsewhere in this codebase. */
export function isValidEmailShape(email: string): boolean {
  return EMAIL_SHAPE_RE.test(email);
}

export interface AllowlistRow {
  email: string;
  note: string | null;
  createdAt: string;
  consumedAt: string | null;
}

/** Every allowlisted friend email, newest first, for the admin Friends card. */
export async function listAllowlistedEmails(admin: SupabaseClient<Database>): Promise<AllowlistRow[]> {
  const { data, error } = await admin
    .from("allowed_emails")
    .select("email, note, created_at, consumed_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    email: row.email,
    note: row.note,
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
  }));
}

/** Adds one friend email to the allowlist. Caller validates shape; this always lowercases before insert. */
export async function addAllowlistedEmail(
  admin: SupabaseClient<Database>,
  email: string,
  note: string | null
): Promise<void> {
  const { error } = await admin.from("allowed_emails").insert({ email: email.toLowerCase(), note });
  if (error) throw error;
}

/**
 * Removes an allowlisted email. Safe to call after the row has already
 * been consumed — the friend's claimed invite stands regardless (see
 * lib/db/allowlist.ts::consumeAllowlistedEmail); this only stops a future
 * auto-claim for that address.
 */
export async function removeAllowlistedEmail(admin: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await admin.from("allowed_emails").delete().eq("email", email.toLowerCase());
  if (error) throw error;
}
