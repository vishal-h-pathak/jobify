import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/dashboard/jobs/[job_id]/mark-failed (M-6 cockpit)
 *
 * "Mark Failed" button. For cases where pre-fill ran but the user
 * couldn't complete submission (form rejected upload, ATS site went
 * down, custom question genuinely couldn't be answered honestly, etc.).
 *
 * Body: `{ reason?: string }`
 *
 * Auth: protected by middleware.ts (dashboard_auth cookie).
 */
export async function POST(
  req: NextRequest,
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

  let reason = "marked failed from cockpit";
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim();
    }
  } catch {
    // ignore
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("jobs")
    .update({
      status: "failed",
      status_updated_at: nowIso,
      failure_reason: reason,
    })
    .eq("id", job_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, job_id, status: "failed" });
}
