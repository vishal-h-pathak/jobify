import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { setBoardDormant } from "@/lib/admin/sourceHealth";

/**
 * HUNT2 P3 S6: the admin Sources card's dormant button — the ONLY write
 * path for the `dormantCandidate` kill-rule flag (`sourceHealth.ts`).
 * Detection is automatic (the `source_funnel_rollup` view); acting on it
 * is always this one explicit admin click, never automatic.
 */
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    if (gate.reason === "unauthenticated") return NextResponse.json({ error: gate.reason }, { status: 401 });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const boardId = typeof body?.boardId === "string" ? body.boardId : "";
  if (!boardId) {
    return NextResponse.json({ error: "boardId is required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const result = await setBoardDormant(admin, boardId);
  switch (result.kind) {
    case "not_found":
      return NextResponse.json({ error: "board not found" }, { status: 404 });
    case "not_active":
      return NextResponse.json({ error: "board is not active (already dormant or dead)" }, { status: 409 });
    case "ok":
      return NextResponse.json({ ok: true });
  }
}
