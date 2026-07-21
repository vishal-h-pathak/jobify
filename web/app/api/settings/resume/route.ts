import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAccess } from "@/lib/db/access";
import { getProfileDoc, upsertProfileDoc } from "@/lib/db/profiles";
import { recordOnboardingTurn } from "@/lib/db/ledger";
import { runResumeExtractionTurn } from "@/lib/anthropic/interview";
import { ONBOARDING_MODEL } from "@/lib/anthropic/client";
import { regenerateCv } from "@/lib/profile/regenerateCv";
import { deriveCvProvenance } from "@/lib/settings/cvProvenance";

interface ResumeRequestBody {
  resumeText?: unknown;
}

/**
 * Session 29 (ONB-D) task 2: add/replace the resume after onboarding
 * (owner decision #3). Wires ONB-A's `regenerateCv` helper + real
 * extraction call — this route owns the DB read/write and ledger
 * accounting, per that helper's header comment. A failed extraction throws
 * here (matching web/app/api/onboarding/turn/route.ts's convention of
 * letting LLM failures propagate to a 500) before either
 * upsertProfileDoc or recordOnboardingTurn run, so a failed regeneration
 * never touches the stored doc.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!(await hasAccess(supabase, user))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as ResumeRequestBody | null;
  const resumeText = typeof body?.resumeText === "string" ? body.resumeText.trim() : "";
  if (!resumeText) {
    return NextResponse.json({ error: "resumeText required" }, { status: 400 });
  }

  const existing = await getProfileDoc(supabase, user.id);
  if (!existing) {
    return NextResponse.json({ error: "no profile found — finish onboarding first" }, { status: 404 });
  }

  const extraction = await runResumeExtractionTurn(resumeText);

  await recordOnboardingTurn(createSupabaseAdminClient(), {
    userId: user.id,
    model: ONBOARDING_MODEL,
    inputTokens: extraction.usage.inputTokens,
    outputTokens: extraction.usage.outputTokens,
  });

  const updatedDoc = await regenerateCv(existing.doc, resumeText, {
    runExtraction: async () => extraction,
  });
  await upsertProfileDoc(supabase, user.id, updatedDoc);

  return NextResponse.json({ ok: true, provenance: deriveCvProvenance(updatedDoc) });
}
