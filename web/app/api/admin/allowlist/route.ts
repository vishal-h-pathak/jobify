import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addAllowlistedEmail, isValidEmailShape, removeAllowlistedEmail } from "@/lib/admin/allowlist";

function gateResponse(reason: "unauthenticated" | "forbidden") {
  return NextResponse.json(
    { error: reason === "unauthenticated" ? "not signed in" : "forbidden" },
    { status: reason === "unauthenticated" ? 401 : 403 }
  );
}

/**
 * Add a friend's email to the allowlist (Friends card, SGN-1). `requireAdmin()`
 * runs first and only on `ok: true` does this route construct the
 * service-role client — same gate-before-service-role-client ordering as
 * `/api/admin/invites`.
 */
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gateResponse(gate.reason);

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const rawNote = typeof body?.note === "string" ? body.note.trim() : "";
  if (!isValidEmailShape(email)) {
    return NextResponse.json({ error: "not a valid email address" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  await addAllowlistedEmail(admin, email, rawNote || null);
  return NextResponse.json({ ok: true });
}

/** Remove a friend's email from the allowlist. Harmless post-consumption — see lib/admin/allowlist.ts. */
export async function DELETE(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gateResponse(gate.reason);

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  await removeAllowlistedEmail(admin, email);
  return NextResponse.json({ ok: true });
}
