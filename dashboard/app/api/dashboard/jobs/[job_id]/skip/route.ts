import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/dashboard/jobs/[job_id]/skip (M-6 cockpit)
 *
 * "Skip" button. Marks the row status='skipped' (M-2 enum) and stores
 * an optional reason in application_notes. Skipped rows are inert —
 * they don't show up in any active queue but stay in the table for
 * pattern analysis.
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

  let reason: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.reason === "string") {
      reason = body.reason.trim() || null;
    }
  } catch {
    // ignore
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowIso = new Date().toISOString();
  const update: Record<string, string | null> = {
    status: "skipped",
    status_updated_at: nowIso,
  };
  if (reason) {
    update.application_notes = reason;
  }

  const { error: updateErr } = await admin
    .from("jobs")
    .update(update)
    .eq("id", job_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, job_id, status: "skipped" });
}
