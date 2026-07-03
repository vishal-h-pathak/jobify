import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Service-role client — bypasses RLS entirely. Only construct this inside
 * code that has already authenticated the caller (e.g. after
 * `supabase.auth.getUser()` in a route handler); never pass it to a
 * client component or log its key. Used for exactly the writes the H3
 * session prompt calls out as service-role: the per-turn `budget_ledger`
 * insert. Invite codes are minted out-of-band (not by this app).
 */
export function createSupabaseAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
