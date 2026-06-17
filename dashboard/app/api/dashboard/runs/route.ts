import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/dashboard/runs?limit=20  (Phase 3 dashboard run-buttons)
 *
 * Returns the most recent rows from public.runs, newest first. The
 * RunsPanel on /dashboard polls this every 5s while any visible row is
 * pending or running so the UI surfaces GHA progress without a refresh.
 *
 * The runs table is service-role-only (RLS enabled, no policies) — see
 * jobpipe/tailor/scripts/008_runs.sql in the job-pipeline repo. The
 * service-role read here is fine because the route is gated by the
 * dashboard_auth middleware.
 *
 * Auth: protected by middleware.ts (dashboard_auth cookie).
 */
export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server misconfigured (missing Supabase env vars)" },
      { status: 500 },
    );
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const parsed = limitRaw === null ? 20 : Number.parseInt(limitRaw, 10);
  const limit =
    Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : 20;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("runs")
    .select(
      // `result` (jsonb, migration 009) carries the manual-tailor flow's
      // back-channel payload: { job_id, status, confidence, title,
      // company, review_url|materials_url }. NULL on hunt/tailor runs.
      "id, kind, status, triggered_by, args, started_at, ended_at, " +
        "log_excerpt, failure_reason, github_run_url, result, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: data ?? [] });
}
