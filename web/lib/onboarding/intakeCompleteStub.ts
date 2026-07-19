import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

/**
 * Build-local stand-in for session 43's `lib/onboarding/intakeComplete.ts`
 * (UX1_DESIGN.md §1: `intakeComplete(user) ⇔ onboarding_sessions.status =
 * 'complete'`), which does not exist in this worktree — 43 ships it in a
 * sibling branch. This session only consumes the pinned signature
 * (`44_ux1_dossier_export.md`'s PINNED CONTRACT); the bare specifier
 * `@/lib/onboarding/intakeComplete` is aliased to this file for `tsc`/
 * `next build` (see `types/intakeComplete-ambient.d.ts` and
 * `next.config.ts`/`vitest.config.ts`) so this branch stands alone until
 * merge, at which point real module resolution takes over and this file
 * becomes dead (safe to delete, harmless to keep).
 */
export async function intakeComplete(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("onboarding_sessions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.status === "complete";
}
