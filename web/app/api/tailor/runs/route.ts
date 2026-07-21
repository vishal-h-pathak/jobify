import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAccess } from "@/lib/db/access";
import { pollRuns } from "@/lib/tailor/pollRuns";

const STALE_MINUTES = 10;

/**
 * "Poll this posting's tailor runs": returns the signed-in user's own
 * `tailor_runs` rows for a `posting_id`, reaping any `queued` row the
 * hosted runner never picked up within `STALE_MINUTES` (design doc §1.3).
 * Same auth pattern as `POST /api/hunt/run` / `POST /api/tailor/run`
 * (getUser -> invite-or-admin gate). Flat query-param route, same style as
 * `GET /api/admin/profile-review` — this app has no dynamic API routes.
 *
 * Core logic lives in `pollRuns.ts` so it's unit-testable without a real
 * Next.js request; this handler is just the auth gate + param parsing +
 * client wiring.
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  if (!(await hasAccess(supabase, user))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const postingId = new URL(request.url).searchParams.get("posting_id");
  if (!postingId) {
    return NextResponse.json({ error: "posting_id is required" }, { status: 400 });
  }

  const { runs } = await pollRuns({
    admin: createSupabaseAdminClient(),
    supabase,
    userId: user.id,
    postingId,
    now: () => new Date(),
    staleMinutes: STALE_MINUTES,
  });

  return NextResponse.json({ runs });
}
