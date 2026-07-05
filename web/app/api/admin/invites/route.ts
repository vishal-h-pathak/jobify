import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mintInvites } from "@/lib/admin/invites";

const MAX_MINT_N = 20;

/**
 * Mint N fresh invite codes. `requireAdmin()` runs first and only on
 * `ok: true` does this route construct the service-role client — never
 * before the admin check (see lib/admin/requireAdmin.ts).
 */
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.reason === "unauthenticated" ? "not signed in" : "forbidden" },
      { status: gate.reason === "unauthenticated" ? 401 : 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const n = Number(body?.n);
  if (!Number.isInteger(n) || n < 1 || n > MAX_MINT_N) {
    return NextResponse.json({ error: `n must be an integer between 1 and ${MAX_MINT_N}` }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const codes = await mintInvites(admin, n);
  return NextResponse.json({ ok: true, codes });
}
