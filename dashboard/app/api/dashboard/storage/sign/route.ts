import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, MISCONFIGURED_MSG } from "@/app/lib/supabase-admin";

/**
 * GET /api/dashboard/storage/sign?path=<storage_path>
 *
 * Short-lived signed URL for an object in the job-materials bucket
 * (e.g. prefill screenshots on the review cockpit). Part of the RLS
 * lockdown — the client previously created signed URLs with the anon
 * key. Bucket is fixed server-side; only the object path is caller-
 * controlled, and it's gated by the dashboard_auth middleware.
 *
 * Auth: protected by middleware.ts (dashboard_auth cookie).
 */

const BUCKET = "job-materials";
const TTL_SECONDS = 60 * 10;

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path || path.includes("..")) {
    return NextResponse.json(
      { error: "Expected ?path=<storage path>" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: MISCONFIGURED_MSG }, { status: 500 });
  }

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to sign URL" },
      { status: 404 },
    );
  }
  return NextResponse.json({ url: data.signedUrl });
}
