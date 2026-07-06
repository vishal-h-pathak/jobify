import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";

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
  const anchor = freeText
    ? { free_text: freeText }
    : {
        current_title: currentTitle,
        current_company: currentCompany,
        ...(yearsInRole ? { years_in_role: yearsInRole } : {}),
      };

  await saveSession(supabase, user.id, {
    extracted: { ...session.extracted, anchor },
    stage: "calibration",
  });

  return NextResponse.json({ stage: "calibration" });
}
