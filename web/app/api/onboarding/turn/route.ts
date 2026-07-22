import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSession } from "@/lib/db/onboardingSession";
import { hasAccess } from "@/lib/db/access";
import { runEngineTurn } from "@/lib/anthropic/interview";
import { handleOnboardingTurn } from "@/lib/onboarding/handleTurn";
import type { ModulesState } from "@/lib/onboarding/moduleRegistry";

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
  // Admins bypass the invite gate — they may not hold a claimed code.
  if (!(await hasAccess(supabase, user))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message : "";
  if (!message.trim()) {
    return NextResponse.json({ error: "missing message" }, { status: 400 });
  }

  const session = await getOrCreateSession(supabase, user.id, user);
  const result = await handleOnboardingTurn({
    userId: user.id,
    userEmail: user.email ?? "",
    userMessage: message,
    session: {
      stage: session.stage,
      messages: session.messages,
      extracted: session.extracted,
      status: session.status,
      modules: (session.modules ?? {}) as ModulesState,
    },
    supabase,
    admin: createSupabaseAdminClient(),
    runTurn: runEngineTurn,
  });

  return NextResponse.json(result);
}
