import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { validateProfileDoc } from "../profile/validate";

export interface ProfileDocRow {
  doc: Record<string, string>;
  validationStatus: { status: string; errors: string[] } | null;
}

/**
 * Reads the signed-in user's own `profiles` row (doc + validation_status)
 * via the authed request-scoped client — own-row SELECT policy from 0002,
 * same as `getMonthToDateSpend`. `null` means onboarding hasn't finished
 * (no profiles row yet), which settings-resume callers treat as "nothing
 * to regenerate".
 */
export async function getProfileDoc(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ProfileDocRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("doc, validation_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { doc: data.doc, validationStatus: data.validation_status } : null;
}

/**
 * Writes the finished interview's `profiles.doc` + `validation_status`.
 * Uses the authed request-scoped client (own-row INSERT/UPDATE policy from
 * 0002) — no service-role needed here, unlike the ledger write.
 * `validation_status` here is the TS pass's verdict only ("unchecked" is
 * never written by this path since the doc is always fully assembled
 * before this call runs); H4's worker overwrites it with the
 * authoritative Python validator's verdict at materialization time.
 */
export async function upsertProfileDoc(
  supabase: SupabaseClient<Database>,
  userId: string,
  doc: Record<string, string>
): Promise<{ status: "valid" | "invalid"; errors: string[] }> {
  const result = validateProfileDoc(doc);
  const { error } = await supabase.from("profiles").upsert({
    user_id: userId,
    doc,
    validation_status: { status: result.status, errors: result.errors },
  });
  if (error) throw error;
  return { status: result.status, errors: result.errors };
}
