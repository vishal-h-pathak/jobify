import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { MODULE_REGISTRY, markModuleComplete } from "@/lib/onboarding/moduleRegistry";
import { buildCheckpointDeps } from "@/lib/onboarding/checkpointDeps";
import { maybeFireCheckpoint } from "@/lib/onboarding/checkpoint";

interface AnchorRequestBody {
  current_title?: unknown;
  current_company?: unknown;
  years_in_role?: unknown;
  free_text?: unknown;
}

/**
 * ONB-A §2 stage 1: the anchor form. Zero LLM calls, zero ledger row —
 * writes extracted.anchor server-side and advances straight to
 * 'calibration'; the generated calibration prompts are produced lazily by
 * GET /api/onboarding/state, not here.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!isAdmin(user) && !(await hasClaimedInvite(supabase))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as AnchorRequestBody | null;
  const currentTitle = typeof body?.current_title === "string" ? body.current_title.trim() : "";
  const currentCompany = typeof body?.current_company === "string" ? body.current_company.trim() : "";
  const yearsInRole = typeof body?.years_in_role === "string" ? body.years_in_role.trim() : "";
  const freeText = typeof body?.free_text === "string" ? body.free_text.trim() : "";

  // The escape path ("I'm between roles / describe your situation") and
  // the two-field form are mutually exclusive — free_text wins if both
  // somehow arrive, since it's the more specific signal.
  if (!freeText && !(currentTitle && currentCompany)) {
    return NextResponse.json(
      { error: "provide current_title + current_company, or free_text" },
      { status: 400 }
    );
  }

  const session = await getOrCreateSession(supabase, user.id);

  // Replay/resubmit guard: a stray second tab, a browser back-button
  // resubmit, or a client retry must never rewind an in-progress or
  // completed session back to 'calibration' — saveSession is a partial
  // column update, so doing so would silently strand the row's
  // messages/extracted from every later stage while resetting `stage`.
  if (session.stage !== "anchor") {
    return NextResponse.json({ error: "onboarding has already moved past the anchor stage" }, { status: 409 });
  }

  const anchor = freeText
    ? { free_text: freeText }
    : {
        current_title: currentTitle,
        current_company: currentCompany,
        ...(yearsInRole ? { years_in_role: yearsInRole } : {}),
      };

  // V3A-B1: this route predates the module-progress model (moduleRegistry.ts)
  // and never marked `modules.anchor` complete, so `phaseOneComplete` (which
  // requires anchor) could never flip true and the background-hunt
  // checkpoint could never fire. Mark it here, same pattern as the other
  // module routes.
  const receipt = MODULE_REGISTRY.anchor.receipt(anchor) ?? "";
  const modules = markModuleComplete(session, "anchor", receipt);
  const extracted = { ...session.extracted, anchor };

  await saveSession(supabase, user.id, {
    extracted,
    stage: "calibration",
    modules,
  });

  // anchor can be the module that completes phase 1 last (e.g. a user who
  // reacts/values/dealbreakers before filling in the anchor form) — same
  // checkpoint call every other module-completion route already makes.
  await maybeFireCheckpoint(buildCheckpointDeps(), { ...session, extracted, modules }, user);

  return NextResponse.json({ stage: "calibration" });
}
