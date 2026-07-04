import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimInvite } from "@/lib/db/invites";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: "missing code" }, { status: 400 });
  }

  const claimed = await claimInvite(supabase, code);
  if (!claimed) {
    return NextResponse.json({ error: "invalid or already-used invite code" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
