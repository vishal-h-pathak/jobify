import { NextResponse } from "next/server";
import { createAdminClient, MISCONFIGURED_MSG } from "@/app/lib/supabase-admin";

/**
 * GET /api/dashboard/jobs/action-count
 *
 * Count of jobs waiting on the human in the submit lane — tailored and
 * waiting to be staged (ready_for_review) plus staged and waiting to be
 * submitted (awaiting_human_submit). Matches the review-queue view and
 * lifecycle.ts::isActionNeeded (minus `failed`, which the queue surfaces
 * separately). Polled by DashboardNav for the badge. Part of the RLS
 * lockdown — was a direct anon-key count query.
 *
 * Auth: protected by proxy.ts (dashboard_auth cookie).
 */
export async function GET() {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: MISCONFIGURED_MSG }, { status: 500 });
  }

  const { count, error } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["ready_for_review", "awaiting_human_submit"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ count: count ?? 0 });
}
