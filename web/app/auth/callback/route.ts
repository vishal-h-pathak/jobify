import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { hasClaimedInvite } from "@/lib/db/invites";

/**
 * The redirect `NextResponse` is built up front so cookies attach
 * directly to it — going through `next/headers` `cookies()` here can
 * racily lose cookies set during `exchangeCodeForSession` under the App
 * Router's Route Handlers (a real bug hit in a prior magic-link
 * implementation this route mirrors). Don't "simplify" this back to
 * `cookies()` without re-testing that. When `next` is absent or unsafe,
 * the eventual target depends on `hasClaimedInvite` (only knowable after
 * the session exchange below), so the Location header on this same
 * up-front response gets rewritten in place rather than building a
 * second response.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only same-origin relative paths: `?next=@evil.com` or `?next=//evil.com`
  // would otherwise make `${origin}${next}` resolve off-host.
  const rawNext = searchParams.get("next");
  const safeNext = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth-failed`);
  }

  const response = NextResponse.redirect(`${origin}${safeNext ?? "/invite"}`);
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

  // No explicit (or unsafe) next: land claimed users on /feed, everyone
  // else on /invite, instead of always guessing /invite.
  if (!safeNext) {
    const target = (await hasClaimedInvite(supabase)) ? "/feed" : "/invite";
    response.headers.set("location", `${origin}${target}`);
  }

  return response;
}
