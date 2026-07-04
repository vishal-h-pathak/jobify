import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";
import { deleteApiKey, looksLikeAnthropicKey, saveApiKey } from "@/lib/db/keys";

async function requireInvitedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "not signed in" }, { status: 401 }) } as const;
  }
  // Server-side invite enforcement: the (app) layout gates PAGES only —
  // API routes are reachable directly (H3 review lesson, mirrored from
  // web/app/api/onboarding/turn/route.ts).
  if (!(await hasClaimedInvite(supabase))) {
    return { error: NextResponse.json({ error: "invite required" }, { status: 403 }) } as const;
  }
  return { supabase, user } as const;
}

export async function POST(request: Request) {
  const gate = await requireInvitedUser();
  if ("error" in gate) return gate.error;
  const { supabase, user } = gate;

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!looksLikeAnthropicKey(key)) {
    return NextResponse.json({ error: "doesn't look like an Anthropic key (sk-ant-...)" }, { status: 400 });
  }

  await saveApiKey(supabase, user.id, key);
  // Never echo the plaintext key back — only what the UI is allowed to show.
  return NextResponse.json({ ok: true, keyLast4: key.slice(-4) });
}

export async function DELETE() {
  const gate = await requireInvitedUser();
  if ("error" in gate) return gate.error;
  const { supabase, user } = gate;

  await deleteApiKey(supabase, user.id);
  return NextResponse.json({ ok: true });
}
