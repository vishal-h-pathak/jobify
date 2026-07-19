import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { loadApplicationProfile, saveApplicationProfile } from "@/lib/submit/applicationProfile";

/**
 * `application_profiles` is service-role only (no `authenticated` RLS
 * policy at all — see migration 0013's comments), so both handlers use
 * the same auth-gate-then-admin-client pattern as
 * `app/api/tailor/materials/[runId]/route.ts`: authenticate the caller
 * first, then do all table access through `createSupabaseAdminClient()`.
 */

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);

  const admin = createSupabaseAdminClient();
  await saveApplicationProfile(admin, user.id, body);

  return new Response(null, { status: 204 });
}

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
  const profile = await loadApplicationProfile(admin, user.id);
  if (!profile) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}
