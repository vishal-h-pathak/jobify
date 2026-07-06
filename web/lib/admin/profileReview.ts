import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export interface UserProfileReview {
  extracted: Record<string, unknown>;
  doc: Record<string, string> | null;
  validationStatus: { status: string; errors: string[] } | null;
}

/**
 * Session 29 (ONB-D) task 1: the admin "Review profile" panel's data —
 * read-only, service-role only (caller must have already passed
 * `requireAdmin()`). Two independent tables since onboarding's working
 * state (`onboarding_sessions.extracted`) and the finished doc
 * (`profiles.doc` + `validation_status`) live separately; either can be
 * absent (in-progress onboarding has no profiles row yet).
 */
export async function getUserProfileReview(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<UserProfileReview> {
  const [sessionRes, profileRes] = await Promise.all([
    admin.from("onboarding_sessions").select("extracted").eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("doc, validation_status").eq("user_id", userId).maybeSingle(),
  ]);
  if (sessionRes.error) throw sessionRes.error;
  if (profileRes.error) throw profileRes.error;

  return {
    extracted: sessionRes.data?.extracted ?? {},
    doc: profileRes.data?.doc ?? null,
    validationStatus: profileRes.data?.validation_status ?? null,
  };
}
