import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/dashboard/jobs/[job_id]/prefill (M-6 cockpit)
 *
 * Cockpit "Pre-fill Form" button. Flips the row to status='prefilling';
 * the polling loop in job-applicant/main.py picks it up next cycle and
 * dispatches to the per-ATS DOM handler (or vision-agent fallback) in
 * a visible browser the human will eventually submit themselves.
 *
 * Guards on status='ready_for_review' so an accidental click on a row
 * the orchestrator is already processing doesn't double-dispatch.
 *
 * Auth: protected by middleware.ts (dashboard_auth cookie).
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ job_id: string }> },
) {
  const { job_id } = await context.params;
  if (!job_id) {
    return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server misconfigured (missing Supabase env vars)" },
      { status: 500 },
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: current, error: readErr } = await admin
    .from("jobs")
    .select("id, status")
    .eq("id", job_id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (current.status !== "ready_for_review") {
    return NextResponse.json(
      {
        error:
          `Job is in state "${current.status}", not ready_for_review. ` +
          `Refresh and try again.`,
      },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("jobs")
    .update({
      status: "prefilling",
      status_updated_at: nowIso,
    })
    .eq("id", job_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, job_id, status: "prefilling" });
}
