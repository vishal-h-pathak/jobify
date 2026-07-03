import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * A Supabase client bound to the current request's session cookies, for
 * use in Server Components / Route Handlers / Server Functions. Respects
 * RLS as the signed-in user (or as anon if there's no session) — this is
 * what the app uses everywhere EXCEPT the two writes the session prompt
 * explicitly calls out as service-role-only (the `budget_ledger` insert
 * and minting invite codes) — see `lib/supabase/admin.ts`.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies — the proxy (proxy.ts)
            // refreshes the session cookie on the next request instead.
          }
        },
      },
    }
  );
}
