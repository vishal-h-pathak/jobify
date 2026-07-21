import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAccess } from "@/lib/db/access";
import { isAdmin } from "@/lib/admin/isAdmin";
import { dispatchHunt } from "@/lib/hunt/dispatchHunt";

const DEFAULT_COOLDOWN_HOURS = 6;

/**
 * "Run my hunt" (HNT-1): dispatches `hosted-hunt.yml --user <uuid>` for
 * the signed-in user via the GitHub Actions REST API. Same auth pattern
 * as the onboarding routes (getUser -> invite-or-admin gate) plus a
 * `dispatchHunt` call that owns the profile/cooldown/dispatch sequence.
 *
 * `{ userId }` in the body is honored ONLY for admins (the admin panel's
 * "Run hunt for user" button reuses this same route) — a non-admin
 * caller always targets themselves regardless of what the body says.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const admin = isAdmin(user);
  if (!admin && !(await hasAccess(supabase, user))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const requestedUserId = typeof body?.userId === "string" ? body.userId : null;
  const targetUserId = admin && requestedUserId ? requestedUserId : user.id;

  const cooldownHours = Number(process.env.HUNT_COOLDOWN_HOURS ?? DEFAULT_COOLDOWN_HOURS);

  const result = await dispatchHunt({
    admin: createSupabaseAdminClient(),
    targetUserId,
    bypassCooldown: admin,
    cooldownHours,
    githubRepo: process.env.GITHUB_REPO,
    githubToken: process.env.GITHUB_DISPATCH_TOKEN,
    fetchImpl: fetch,
    now: () => new Date(),
  });

  switch (result.kind) {
    case "no_profile":
      return NextResponse.json({ error: "no profile for that user" }, { status: 404 });
    case "invalid_profile":
      return NextResponse.json({ error: "profile is invalid" }, { status: 422 });
    case "cooldown":
      return NextResponse.json({ error: "cooldown", cooldown_until: result.cooldownUntil }, { status: 429 });
    case "not_configured":
      // Log, never throw — a missing env var is an ops problem, not a
      // 500. Only the fact that config is missing is logged, never a
      // secret value (there's nothing to log here anyway).
      console.error("POST /api/hunt/run: GITHUB_REPO or GITHUB_DISPATCH_TOKEN is not set");
      return NextResponse.json({ error: "hunt dispatch is not configured" }, { status: 503 });
    case "dispatch_failed":
      console.error("POST /api/hunt/run: GitHub dispatch failed with status", result.status);
      return NextResponse.json({ error: "dispatch failed" }, { status: 502 });
    case "ok":
      return NextResponse.json({ ok: true, cooldown_until: result.cooldownUntil });
  }
}
