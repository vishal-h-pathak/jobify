import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, MISCONFIGURED_MSG } from "@/app/lib/supabase-admin";

/**
 * GET   /api/dashboard/jobs/[job_id]  — full job row (review cockpit).
 * PATCH /api/dashboard/jobs/[job_id]  — update status, match_chat,
 *        and/or application_notes.
 *
 * Part of the RLS lockdown: the dashboard's direct anon-key writes
 * (status changes from the list/swipe views, MatchAgent chat
 * persistence) moved here. Only the fields the UI actually writes
 * are accepted — anything else in the body is a 400, so a compromised
 * dashboard session can't rewrite arbitrary columns.
 *
 * `application_notes` was added for reject-with-reason: dismissing a
 * row from the list can attach a one-line reason that the pattern
 * analyzer (J-6) reads — same field the /skip route writes. Purely
 * additive; status-machine semantics unchanged.
 *
 * Auth: protected by middleware.ts (dashboard_auth cookie).
 */

// M-2 canonical lifecycle. Migration 007's CHECK constraint is the
// real gate; this list just gives a clean 400 instead of a 500.
const WRITABLE_STATUSES = new Set([
  "discovered",
  "new",
  "approved",
  "preparing",
  "ready_for_review",
  "prefilling",
  "awaiting_human_submit",
  "applied",
  "failed",
  "skipped",
  "expired",
  "ignored",
]);

function isValidMatchChat(v: unknown): v is { role: string; content: string }[] {
  return (
    Array.isArray(v) &&
    v.every(
      (m) =>
        m !== null &&
        typeof m === "object" &&
        (m as { role?: unknown }).role !== undefined &&
        ["user", "assistant"].includes((m as { role: string }).role) &&
        typeof (m as { content?: unknown }).content === "string",
    )
  );
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ job_id: string }> },
) {
  const { job_id } = await context.params;
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: MISCONFIGURED_MSG }, { status: 500 });
  }

  const { data, error } = await admin
    .from("jobs")
    .select("*")
    .eq("id", job_id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ job: data });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ job_id: string }> },
) {
  const { job_id } = await context.params;
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: MISCONFIGURED_MSG }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "status") {
      if (typeof value !== "string" || !WRITABLE_STATUSES.has(value)) {
        return NextResponse.json(
          { error: `Invalid status: ${String(value)}` },
          { status: 400 },
        );
      }
      update.status = value;
    } else if (key === "match_chat") {
      if (!isValidMatchChat(value)) {
        return NextResponse.json(
          { error: "Invalid match_chat: expected [{role, content}]" },
          { status: 400 },
        );
      }
      update.match_chat = value;
    } else if (key === "application_notes") {
      if (typeof value !== "string" || value.length > 2000) {
        return NextResponse.json(
          { error: "Invalid application_notes: expected string ≤ 2000 chars" },
          { status: 400 },
        );
      }
      update.application_notes = value.trim() || null;
    } else {
      return NextResponse.json(
        { error: `Field not writable: ${key}` },
        { status: 400 },
      );
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "Empty update: expected status, match_chat, and/or application_notes" },
      { status: 400 },
    );
  }

  const { error } = await admin.from("jobs").update(update).eq("id", job_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
