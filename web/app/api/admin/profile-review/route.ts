import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getUserProfileReview } from "@/lib/admin/profileReview";

/**
 * Session 29 (ONB-D) task 1: read-only admin drill-in for one user's
 * onboarding extraction + profile doc + validation status. Flat query-param
 * route (no dynamic `[userId]` segment) — this app has no other dynamic API
 * routes, so this stays consistent with the existing flat style.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: gate.reason === "unauthenticated" ? 401 : 403 });
  }

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // Only constructed after requireAdmin() confirms the caller is an admin.
  const admin = createSupabaseAdminClient();
  const review = await getUserProfileReview(admin, userId);
  return NextResponse.json(review);
}
