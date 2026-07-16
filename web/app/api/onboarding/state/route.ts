import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSession } from "@/lib/db/onboardingSession";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { runCalibrationGeneration } from "@/lib/anthropic/interview";
import { maybeGenerateCalibrationPrompts } from "@/lib/onboarding/maybeGenerateCalibration";
import type { ModulesState } from "@/lib/onboarding/moduleRegistry";
import { VALUE_PAIRS, ENVIRONMENT_SCENARIOS } from "@/lib/onboarding/moduleWriters";
import { deriveNextModule, type InterviewStage } from "@/components/onboarding/moduleOrder";

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

  // V3A-B1 (V3A_DESIGN.md §1.2): resumability — the client's PhaseRail and
  // panel router are driven by `modules`/`next_module`, not `stage`, so a
  // returning user lands directly on their next incomplete module with the
  // rail already filled, no replay or summary screen.
  const modules = (session.modules ?? {}) as ModulesState;
  const stage = session.stage as InterviewStage;
  const nextModule = deriveNextModule(modules, stage);
  const checkpointFired = Boolean(modules.checkpoint_hunt);

  // Cheap exact count, not a full row fetch — powers the ambient status
  // chip ("N matches waiting"). RLS + the explicit filter both scope this
  // to the caller's own rows.
  const { count: matchCount, error: matchCountError } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (matchCountError) throw matchCountError;

  return NextResponse.json({
    ...withCalibration,
    modules,
    next_module: nextModule,
    checkpoint_fired: checkpointFired,
    match_count: matchCount ?? 0,
    value_pairs: VALUE_PAIRS,
    environment_scenarios: ENVIRONMENT_SCENARIOS,
  });
}
