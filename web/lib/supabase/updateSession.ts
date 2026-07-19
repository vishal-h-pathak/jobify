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
 *
 * Also forwards the current pathname as an `x-pathname` request header
 * (UX-1: the gate needs it to exclude `/onboarding` itself from the
 * incomplete-intake redirect) — Server Components have no other way to
 * read the request path, since Next.js doesn't expose it via `headers()`
 * on its own.
 */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

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
