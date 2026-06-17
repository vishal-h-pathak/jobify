import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/dashboard/jobs/[job_id]/mark-applied (M-6 cockpit)
 *
 * The single source of truth for "this job got submitted" — the system
 * never auto-applies. The human reviewed the visible browser the
 * orchestrator left open, clicked Submit themselves, and is now
 * confirming here.
 *
 * Body: `{ submission_notes?: string }` — optional free-text the human
 * can attach about what needed manual fixing (e.g. "salary field
 * rejected $130k, had to enter $129,999").
 *
 * Sets:
 *   status              = 'applied'
 *   submitted_at        = now()  (M-3 column, source of truth)
 *   applied_at          = now()  (legacy column kept in sync)
 *   submission_notes    = body.submission_notes
 *   status_updated_at   = now()
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

  let submissionNotes: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.submission_notes === "string") {
      submissionNotes = body.submission_notes.trim() || null;
    }
  } catch {
    // ignore — empty body is fine
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowIso = new Date().toISOString();
  const update: Record<string, string | null> = {
    status: "applied",
    status_updated_at: nowIso,
    submitted_at: nowIso,
    applied_at: nowIso,
  };
  if (submissionNotes) {
    update.submission_notes = submissionNotes;
  }

  const { error: updateErr } = await admin
    .from("jobs")
    .update(update)
    .eq("id", job_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    job_id,
    status: "applied",
    submitted_at: nowIso,
  });
}
