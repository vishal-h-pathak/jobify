import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdmin } from "./isAdmin";

export type AdminGate =
  | { ok: true; user: User; supabase: SupabaseClient<Database> }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

/**
 * Shared admin gate for the `/admin` page and every `/api/admin/*` route:
 * getUser() -> unauthenticated if none -> isAdmin -> forbidden if not.
 * Callers must never construct a service-role client before this returns
 * `ok: true` (see web/lib/supabase/admin.ts) — API routes turn the two
 * `ok: false` reasons into 401/403, the page turns them into a redirect.
 */
export async function requireAdmin(): Promise<AdminGate> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated" };
  if (!isAdmin(user)) return { ok: false, reason: "forbidden" };
  return { ok: true, user, supabase };
}
