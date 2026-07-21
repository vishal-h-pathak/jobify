import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listPendingCandidates, listRecentAutoAdmittedCandidates } from "@/lib/admin/candidates";

/**
 * HUNT2 P2 S4: the admin candidates card's data route — the pending
 * review queue plus a read-only recent-auto-admits list, in one GET
 * (mirrors `/api/admin/profile-review`'s flat, no-dynamic-segment style).
 */
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    // A signed-in non-admin gets 404, not 403 — never confirm this route
    // exists to someone who's authenticated but not an admin (ADM-3 house rule).
    if (gate.reason === "unauthenticated") return NextResponse.json({ error: gate.reason }, { status: 401 });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const [pending, recentAutoAdmitted] = await Promise.all([
    listPendingCandidates(admin),
    listRecentAutoAdmittedCandidates(admin),
  ]);
  return NextResponse.json({ pending, recentAutoAdmitted });
}
