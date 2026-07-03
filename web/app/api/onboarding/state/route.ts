import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateSession } from "@/lib/db/onboardingSession";
import { hasClaimedInvite } from "@/lib/db/invites";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  // Server-side invite enforcement (see turn/route.ts): getOrCreateSession
  // WRITES an onboarding_sessions row, so the uninvited must 403 here too.
  if (!(await hasClaimedInvite(supabase))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const session = await getOrCreateSession(supabase, user.id);
  return NextResponse.json({
    stage: session.stage,
    messages: session.messages,
    status: session.status,
  });
}
