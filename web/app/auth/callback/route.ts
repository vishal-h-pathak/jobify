import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { hasClaimedInvite } from "@/lib/db/invites";
import { consumeAllowlistedEmail } from "@/lib/db/allowlist";
import { isAdmin } from "@/lib/admin/isAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth-failed`);
  }

  // No explicit (or unsafe) next: admins land on /admin (they may never
  // hold a claimed invite of their own — see lib/admin/requireAdmin.ts);
  // everyone else lands on /feed if claimed. Otherwise (SGN-1), check
  // whether the operator pre-approved this email in `allowed_emails` — a
  // hit auto-mints+claims an invite and sends them straight to
  // /onboarding; a miss (or any failure) falls through to the normal
  // /invite routing untouched.
  if (!safeNext) {
    let target: string;
    if (isAdmin(data.user)) {
      target = "/admin";
    } else if (await hasClaimedInvite(supabase)) {
      target = "/feed";
    } else {
      const admin = createSupabaseAdminClient();
      target = (await consumeAllowlistedEmail(admin, data.user)) ? "/onboarding" : "/invite";
    }
    response.headers.set("location", `${origin}${target}`);
  }

  return response;
}
