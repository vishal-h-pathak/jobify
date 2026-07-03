import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

/**
 * The redirect `NextResponse` is built up front so cookies attach
 * directly to it — going through `next/headers` `cookies()` here can
 * racily lose cookies set during `exchangeCodeForSession` under the App
 * Router's Route Handlers (a real bug hit in the papercuts magic-link
 * implementation this route mirrors). Don't "simplify" this back to
 * `cookies()` without re-testing that.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/invite";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth-failed`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth-failed`);
  }
  return response;
}
