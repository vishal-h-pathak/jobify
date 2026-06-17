import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchWorkflow } from "@/app/lib/github-dispatch";

/**
 * POST /api/dashboard/runs/tailor  (Phase 3 + PR-14)
 *
 * Two callers:
 *   - RunsPanel "Run tailor" button (no body) — bulk path, tailors
 *     every status='approved' row.
 *   - Per-row "Tailor" button on the dashboard's ActionButtons
 *     (PR-14) — POSTs { job_id } and only that single row gets
 *     tailored.
 *
 * Inserts a public.runs row (status='pending') and dispatches
 * .github/workflows/tailor.yml in the job-pipeline repo with the row
 * id as the workflow `run_id` input. When `job_id` is supplied it's
 * also forwarded as a workflow input so the GHA job invokes
 * `jobpipe-tailor --once --job-id <uuid>` instead of the bulk
 * `jobpipe-tailor --once`.
 *
 * Body (optional): { job_id?: string }
 *   - If absent: bulk tailor (process_approved_jobs in pipeline).
 *   - If present: must be a 16-char lowercase-hex jobs.id (the sha1
 *     prefix shape jobpipe.shared.jobid.make_job_id produces) AND the
 *     row must exist with status='approved'. 400 otherwise.
 *
 * Auth: protected by middleware.ts (dashboard_auth cookie).
 */

// Match the `sha1(...)[:16]` shape jobpipe.shared.jobid.make_job_id
// emits. Cheap pre-DB-roundtrip rejection for obviously bad input.
const JOB_ID_RE = /^[0-9a-f]{16}$/;

export async function POST(req: NextRequest) {
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

  // ── Parse + validate optional job_id ──────────────────────────────
  const body = await req.json().catch(() => ({}));
  let jobId: string | null = null;
  if (typeof body?.job_id === "string" && body.job_id.length > 0) {
    const candidate = body.job_id.trim().toLowerCase();
    if (!JOB_ID_RE.test(candidate)) {
      return NextResponse.json(
        {
          error:
            "Invalid job_id: expected 16 lowercase hex chars " +
            "(jobpipe.shared.jobid format).",
        },
        { status: 400 },
      );
    }
    const { data: row, error: lookupErr } = await admin
      .from("jobs")
      .select("id, status")
      .eq("id", candidate)
      .maybeSingle();
    if (lookupErr) {
      return NextResponse.json(
        { error: lookupErr.message },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json(
        { error: `Job not found: ${candidate}` },
        { status: 400 },
      );
    }
    if (row.status !== "approved") {
      return NextResponse.json(
        {
          error:
            `Job ${candidate} is in state "${row.status}", not 'approved'. ` +
            `Refresh and try again.`,
        },
        { status: 400 },
      );
    }
    jobId = candidate;
  }

  // ── Insert runs row (record the requested target in args) ─────────
  const { data: inserted, error: insertErr } = await admin
    .from("runs")
    .insert({
      kind: "tailor",
      status: "pending",
      triggered_by: "dashboard",
      args: jobId ? { job_id: jobId } : null,
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

  // ── Dispatch the workflow ────────────────────────────────────────
  const dispatchInputs: Record<string, string> = { run_id: runId };
  if (jobId) {
    dispatchInputs.job_id = jobId;
  }
  const dispatch = await dispatchWorkflow("tailor.yml", dispatchInputs);

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
