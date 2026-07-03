import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSession } from "@/lib/db/onboardingSession";
import { hasClaimedInvite } from "@/lib/db/invites";
import { runInterviewTurn } from "@/lib/anthropic/interview";
import { handleOnboardingTurn } from "@/lib/onboarding/handleTurn";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  // Server-side invite enforcement: the (app) layout gates PAGES only —
  // API routes are reachable directly. No claimed invite → no LLM spend,
  // no profile writes (spec: 12_h3_onboarding_web.md task 2).
  if (!(await hasClaimedInvite(supabase))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message : "";
  if (!message.trim()) {
    return NextResponse.json({ error: "missing message" }, { status: 400 });
  }

  const session = await getOrCreateSession(supabase, user.id);
  const result = await handleOnboardingTurn({
    userId: user.id,
    userMessage: message,
    session: {
      stage: session.stage,
      messages: session.messages,
      extracted: session.extracted,
      status: session.status,
    },
    supabase,
    admin: createSupabaseAdminClient(),
    runTurn: runInterviewTurn,
  });

  return NextResponse.json(result);
}
