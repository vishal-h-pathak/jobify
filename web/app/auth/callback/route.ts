import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { hasAccess } from "@/lib/db/access";
import { isAdmin } from "@/lib/admin/isAdmin";

/**
 * The redirect `NextResponse` is built up front so cookies attach
 * directly to it — going through `next/headers` `cookies()` here can
 * racily lose cookies set during `exchangeCodeForSession` under the App
 * Router's Route Handlers (a real bug hit in a prior magic-link
 * implementation this route mirrors). Don't "simplify" this back to
 * `cookies()` without re-testing that. When `next` is absent or unsafe,
 * the eventual target depends on `hasAccess` (only knowable after
 * the session exchange below), so the Location header on this same
 * up-front response gets rewritten in place rather than building a
 * second response.
 *
 * IMPORTANT: this route's own `hasAccess` check is an optimization, not
 * the guarantee — when `next` IS set (e.g. `/invite?code=...` preserved
 * through login), this route skips straight to that target without
 * checking access at all. Correctness comes from every landing page
 * (`/invite`, `(app)` layout, `/`) calling `hasAccess` itself, which is
 * exactly what closed the 2026-07-21 bug: an allowlisted user landing on
 * `/invite` post-login used to see the invite-code form forever, because
 * the allowlist auto-claim only ever ran in this one `!safeNext` branch.
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
  // everyone else lands on /feed if they have access (claimed invite,
  // allowlist auto-claim, or admin — see lib/db/access.ts), otherwise
  // /invite. Downstream gates re-derive the same thing, so this is a
  // shortcut, not the source of truth.
  if (!safeNext) {
    const target = isAdmin(data.user) ? "/admin" : (await hasAccess(supabase, data.user)) ? "/feed" : "/invite";
    response.headers.set("location", `${origin}${target}`);
  }

  return response;
}
