import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/materials/[jobId]/[kind]
 *
 * Returns a short-lived redirect to a signed URL for the requested PDF stored
 * in the `job-materials` Supabase Storage bucket.
 *
 * `kind` must be one of: "resume" | "cover_letter".
 *
 * Auth: behind the dashboard_auth cookie (enforced by middleware).
 */

const BUCKET = "job-materials";
const ALLOWED_KINDS = ["resume", "cover_letter"] as const;
type Kind = (typeof ALLOWED_KINDS)[number];

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string; kind: string }> },
) {
  const { jobId, kind } = await context.params;

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }
  if (!ALLOWED_KINDS.includes(kind as Kind)) {
    return NextResponse.json(
      { error: `Invalid kind: ${kind} (expected one of ${ALLOWED_KINDS.join(", ")})` },
      { status: 400 },
    );
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

  // Look up the storage path on the job row. Falls back to the convention
  // `{jobId}/{kind}.pdf` if the column is empty (jobs prepared before migrate).
  const column = kind === "resume" ? "resume_pdf_path" : "cover_letter_pdf_path";
  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .select(`id, ${column}`)
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr) {
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const storagePath =
    ((job as Record<string, unknown>)[column] as string | null) ??
    `${jobId}/${kind}.pdf`;

  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 10); // 10 minutes

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signErr?.message ?? "Failed to sign URL" },
      { status: 404 },
    );
  }

  // Redirect to the signed URL. Using a 302 so browsers don't cache it —
  // the signature expires.
  return NextResponse.redirect(signed.signedUrl, 302);
}
