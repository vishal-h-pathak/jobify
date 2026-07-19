import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { buildReadyList } from "@/lib/submit/readyList";

/**
 * `GET /api/submit/ready` — lists postings with a succeeded tailor run for
 * the signed-in user, newest-per-posting only. Same auth-gate-then-admin-
 * client pattern as every other authed route in this app (Global
 * Constraints). No query params; an empty list is a valid 200. All
 * assembly logic lives in `buildReadyList`; this handler is just the auth
 * gate plus delegation.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!isAdmin(user) && !(await hasClaimedInvite(supabase))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const list = await buildReadyList(admin, user.id);
  return NextResponse.json(list);
}
