import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchWorkflow } from "@/app/lib/github-dispatch";

/**
 * POST /api/dashboard/runs/hunt  (Phase 3 dashboard run-buttons)
 *
 * Dashboard "Run hunt" button. Inserts a public.runs row (status=
 * 'pending') and dispatches .github/workflows/hunt.yml in the job-
 * pipeline repo with the row id as the workflow `run_id` input. The
 * GHA job (via scripts/mark_run.py) updates that row through running
 * → completed/failed.
 *
 * Body (optional): { mode?: 'local_remote' | 'us_wide' }
 *   Default: 'local_remote'. Stored in runs.args so the panel can
 *   show what was requested.
 *
 * Auth: protected by middleware.ts (dashboard_auth cookie).
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server misconfigured (missing Supabase env vars)" },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const requested =
    typeof body?.mode === "string" ? body.mode : "local_remote";
  const mode = requested === "us_wide" ? "us_wide" : "local_remote";

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: inserted, error: insertErr } = await admin
    .from("runs")
    .insert({
      kind: "hunt",
      status: "pending",
      triggered_by: "dashboard",
      args: { mode },
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to insert runs row" },
      { status: 500 },
    );
  }

  const runId = inserted.id as string;

  const dispatch = await dispatchWorkflow("hunt.yml", {
    run_id: runId,
    mode,
  });

  if (!dispatch.ok) {
    await admin
      .from("runs")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
        failure_reason: dispatch.errorMessage,
      })
      .eq("id", runId);
    return NextResponse.json(
      { error: dispatch.errorMessage, run_id: runId },
      { status: dispatch.status === 500 ? 500 : 502 },
    );
  }

  return NextResponse.json({ ok: true, run_id: runId });
}
