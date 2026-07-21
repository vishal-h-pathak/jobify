import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { getProfileDoc, upsertProfileDoc } from "@/lib/db/profiles";
import { hasAccess } from "@/lib/db/access";
import { recordOnboardingTurn } from "@/lib/db/ledger";
import { ONBOARDING_MODEL } from "@/lib/anthropic/client";
import { runVoiceIngestTurn } from "@/lib/anthropic/moduleTurns";
import { filterVerbatim } from "@/lib/onboarding/verbatim";
import { MODULE_REGISTRY, markModuleComplete } from "@/lib/onboarding/moduleRegistry";
import { applyVoiceToDoc, type VoiceProfileData } from "@/lib/onboarding/moduleWriters/voice";

interface VoiceRequestBody {
  sample?: unknown;
}

/**
 * V3A-B2 task 5: the voice-ingest module. One LLM call
 * (`runVoiceIngestTurn`), one ledger row. `signature_phrases` are
 * verbatim-filtered against the raw `sample` before anything is stored or
 * returned — the model is never trusted to have actually quoted the
 * candidate. Phase 1 has always completed by the time this module runs
 * (canonical order), so this route never calls `maybeFireCheckpoint`.
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

  const body = (await request.json().catch(() => null)) as VoiceRequestBody | null;
  const sample = typeof body?.sample === "string" ? body.sample.trim() : "";
  if (!sample) {
    return NextResponse.json({ error: "sample required" }, { status: 400 });
  }

  const session = await getOrCreateSession(supabase, user.id);

  const turnResult = await runVoiceIngestTurn(sample);

  await recordOnboardingTurn(createSupabaseAdminClient(), {
    userId: user.id,
    model: ONBOARDING_MODEL,
    inputTokens: turnResult.usage.inputTokens,
    outputTokens: turnResult.usage.outputTokens,
  });

  const signaturePhrases = filterVerbatim(turnResult.signature_phrases, (phrase) => phrase, sample);

  const data: VoiceProfileData = {
    register: turnResult.register,
    rhythm: turnResult.rhythm,
    words_used: turnResult.words_used,
    words_avoided: turnResult.words_avoided,
    signature_phrases: signaturePhrases,
  };

  // The design stores the sample alongside the derived fields in
  // `extracted.voice` ("for the dossier"), but `applyVoiceToDoc` only takes
  // the five VoiceProfileData fields — sample is stored, not rendered.
  const extracted = { ...session.extracted, voice: { ...data, sample } };
  const receipt = MODULE_REGISTRY.voice.receipt({ voice: data }) ?? "";
  const modules = markModuleComplete(session, "voice", receipt);

  await saveSession(supabase, user.id, { extracted, modules });

  const profileDoc = await getProfileDoc(supabase, user.id);
  if (profileDoc) {
    const updatedDoc = applyVoiceToDoc(profileDoc.doc, data);
    await upsertProfileDoc(supabase, user.id, updatedDoc);
  }

  return NextResponse.json({ ok: true, key: "voice", receipt });
}
