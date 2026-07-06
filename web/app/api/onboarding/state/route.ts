import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSession } from "@/lib/db/onboardingSession";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { runCalibrationGeneration } from "@/lib/anthropic/interview";
import { maybeGenerateCalibrationPrompts } from "@/lib/onboarding/maybeGenerateCalibration";

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
  // Admins bypass the invite gate — they may not hold a claimed code.
  if (!isAdmin(user) && !(await hasClaimedInvite(supabase))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const session = await getOrCreateSession(supabase, user.id);

  // ONB-A: the first time a session lands in 'calibration', lazily
  // generate its four prompts (one LLM turn) before responding, so the
  // frontend never has to drive a separate "generate now" action.
  const withCalibration = await maybeGenerateCalibrationPrompts({
    userId: user.id,
    session: {
      stage: session.stage,
      messages: session.messages,
      extracted: session.extracted,
      status: session.status,
    },
    supabase,
    admin: createSupabaseAdminClient(),
    runGeneration: runCalibrationGeneration,
  });

  return NextResponse.json(withCalibration);
}
