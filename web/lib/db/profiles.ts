import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { validateProfileDoc } from "../profile/validate";

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
