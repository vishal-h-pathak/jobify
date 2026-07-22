import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { mergeIdentity } from "../onboarding/applyToolCalls";

type SessionRow = Database["public"]["Tables"]["onboarding_sessions"]["Row"];

/**
 * Fix D (session 58): a real Google-auth user almost always already has a
 * name on file — reading it here means the known-context dump
 * (`knownContextLines` in interview.ts) shows it before the identity intent
 * ever comes up, and the model CONFIRMS the name in passing instead of
 * asking, making the no-skip-path stuck loop unreachable in practice. Only
 * `full_name`/`name` are read (the two keys Google's OAuth provider actually
 * populates on `user_metadata`) — never trusted blindly: seeded through the
 * real `mergeIdentity` merger below, so a later chat correction still wins
 * (same non-sentinel-string-wins rule as any other identity update).
 */
function seedNameFromAuthMetadata(user: User | undefined): string | undefined {
  const metadata = user?.user_metadata as Record<string, unknown> | undefined;
  const fullName = typeof metadata?.full_name === "string" ? metadata.full_name.trim() : "";
  const name = typeof metadata?.name === "string" ? metadata.name.trim() : "";
  return fullName || name || undefined;
}

/**
 * Loads (or lazily creates) the caller's onboarding session row. This is
 * what makes the interview resumable: a dropped connection just re-reads
 * this row and re-renders `messages` — no restart. Uses the authed
 * request-scoped client so RLS's own-row policy applies.
 */
export async function getOrCreateSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  authUser?: User
): Promise<SessionRow> {
  const { data: existing, error: selectError } = await supabase
    .from("onboarding_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;

  const seededName = seedNameFromAuthMetadata(authUser);
  const extracted = seededName ? mergeIdentity({}, { name: seededName }) : undefined;

  const { data: created, error: insertError } = await supabase
    .from("onboarding_sessions")
    .insert({
      user_id: userId,
      ...(extracted ? { extracted: extracted as unknown as Record<string, unknown> } : {}),
    })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return created;
}

export async function saveSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  updates: Database["public"]["Tables"]["onboarding_sessions"]["Update"]
): Promise<void> {
  const { error } = await supabase
    .from("onboarding_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
}
