import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

/**
 * Refreshes the Supabase session cookie on every request. Deliberately
 * does NOT gate access here — the auth check lives in the protected
 * layout (`app/(app)/layout.tsx`), matching a proven magic-link pattern: the
 * chunked Supabase auth cookie isn't reliably readable from every proxy
 * runtime, so proxy is a refresh layer only and Server Components are the
 * actual gate.
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Result intentionally ignored — this call exists purely to trigger a
  // cookie refresh when the access token is stale.
  await supabase.auth.getUser();

  return response;
}
