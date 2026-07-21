import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAccess } from "@/lib/db/access";
import { signMaterials } from "@/lib/materials/signMaterials";

// "Short-lived" per the session prompt: 5 minutes. Named so it's never
// repeated as a bare `300` beyond this one declaration.
const SIGNED_URL_EXPIRY_SECONDS = 300;

/**
 * "Get this run's materials": signed URLs for whatever a succeeded
 * `tailor_runs` row actually produced in Storage. Per resolved judgment
 * call #1, this intentionally supersedes `V3B_DESIGN.md` §1.4's "no
 * signed-URL plumbing" line — the session prompt is the binding directive
 * and adds a server-side ownership check beyond storage RLS.
 *
 * Same auth pattern as the other tailor routes (getUser -> invite-or-admin
 * gate). The ownership check below is deliberately a single query filtering
 * both `id` and `user_id` — a row that doesn't exist and a row that exists
 * but belongs to someone else must produce an identical 404, so neither
 * leaks a user-enumeration signal via a 403 or a different error shape.
 * `status !== "succeeded"` gets the same treatment for the same reason:
 * there's no consumer yet that needs to distinguish "doesn't exist" from
 * "exists but isn't ready."
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

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

  const admin = createSupabaseAdminClient();

  const { data: run, error } = await admin
    .from("tailor_runs")
    .select("user_id, posting_id, status")
    .eq("id", runId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!run || run.status !== "succeeded") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const urls = await signMaterials(admin, run.user_id, run.posting_id, SIGNED_URL_EXPIRY_SECONDS);
  return NextResponse.json({ urls });
}
