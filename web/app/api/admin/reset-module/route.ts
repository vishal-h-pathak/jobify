import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resetUserModule, RESETTABLE_MODULE_KEYS } from "@/lib/admin/resetModule";
import type { ModuleKey } from "@/lib/onboarding/moduleRegistry";

function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (RESETTABLE_MODULE_KEYS as string[]).includes(value);
}

/**
 * Admin action (ADM-3 §5): un-sticks one onboarding module for one user —
 * the mirror-regeneration failure mode the owner hit live (mirror stuck
 * "complete" on a bad output, no way to force it to run again short of a
 * manual DB edit). Server-validated: both `userId` and `module` are
 * checked before any write.
 */
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    // ADM-3: a signed-in non-admin gets 404, not 403 — never confirm this
    // route exists to someone who's authenticated but not an admin.
    if (gate.reason === "unauthenticated") return NextResponse.json({ error: "not signed in" }, { status: 401 });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const moduleKey = body?.module;
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (!isModuleKey(moduleKey)) {
    return NextResponse.json({ error: `module must be one of: ${RESETTABLE_MODULE_KEYS.join(", ")}` }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const result = await resetUserModule(admin, userId, moduleKey);

  switch (result.kind) {
    case "no_session":
      return NextResponse.json({ error: "no onboarding session for that user" }, { status: 404 });
    case "not_completed":
      return NextResponse.json({ ok: true, changed: false });
    case "ok":
      return NextResponse.json({ ok: true, changed: true });
  }
}
