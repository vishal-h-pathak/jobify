import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { approveCandidate, rejectCandidate } from "@/lib/admin/candidates";

/**
 * HUNT2 P2 S4: one-click Approve / Reject for a pending candidate_boards
 * row. Server-validates everything — `candidateId` and `decision` are
 * both checked before either lib function ever touches the DB; a reject
 * without a reason is allowed (`reason` defaults to `""`, stored as
 * `null` — see `rejectCandidate`), an approve is not conditional on
 * anything the client sends beyond the id.
 */
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    if (gate.reason === "unauthenticated") return NextResponse.json({ error: "not signed in" }, { status: 401 });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  const decision = body?.decision;
  if (!candidateId) {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  if (decision === "approve") {
    const result = await approveCandidate(admin, candidateId);
    switch (result.kind) {
      case "not_found":
        return NextResponse.json({ error: "candidate not found" }, { status: 404 });
      case "not_pending":
        return NextResponse.json({ error: "candidate was already decided" }, { status: 409 });
      case "missing_board_info":
        return NextResponse.json(
          { error: "this candidate has no probed board (ats/slug) to approve — reject it instead" },
          { status: 422 }
        );
      case "ok":
        return NextResponse.json({ ok: true });
    }
  }

  const reason = typeof body?.reason === "string" ? body.reason : "";
  const result = await rejectCandidate(admin, candidateId, reason);
  switch (result.kind) {
    case "not_found":
      return NextResponse.json({ error: "candidate not found" }, { status: 404 });
    case "not_pending":
      return NextResponse.json({ error: "candidate was already decided" }, { status: 409 });
    case "ok":
      return NextResponse.json({ ok: true });
  }
}
