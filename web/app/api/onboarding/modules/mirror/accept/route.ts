import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { getProfileDoc, upsertProfileDoc } from "@/lib/db/profiles";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { MODULE_REGISTRY, markModuleComplete } from "@/lib/onboarding/moduleRegistry";
import { setThesisIntroFromMirror } from "@/lib/onboarding/moduleWriters/mirror";

interface MirrorAcceptRequestBody {
  paragraphs?: unknown;
}

function parseParagraphs(value: unknown): [string, string] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [a, b] = value;
  if (typeof a !== "string" || typeof b !== "string") return null;
  if (!a.trim() || !b.trim()) return null;
  return [a, b];
}

/**
 * V3A-B2 task 5: the mirror-accept POST — zero-LLM. Trusts the client's
 * submitted `paragraphs` (possibly inline-edited by the candidate) rather
 * than re-deriving from `extracted.mirror_draft`, per the design's explicit
 * allowance for editing the reflection before accepting it. `quoted_phrases`
 * for the receipt/stored record still come from the last generated draft —
 * informational only, not re-verified against the (possibly-edited) final
 * text. This is the module that completes onboarding overall
 * (V3A_DESIGN.md §2.3), so `status: "complete"` is set here too.
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

  const body = (await request.json().catch(() => null)) as MirrorAcceptRequestBody | null;
  const paragraphs = parseParagraphs(body?.paragraphs);
  if (!paragraphs) {
    return NextResponse.json({ error: "paragraphs must be exactly two non-empty strings" }, { status: 400 });
  }

  const session = await getOrCreateSession(supabase, user.id);
  const draft = session.extracted.mirror_draft as { quoted_phrases?: unknown } | undefined;
  const quotedPhrases = Array.isArray(draft?.quoted_phrases)
    ? (draft?.quoted_phrases as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const mirror = { paragraphs, quoted_phrases: quotedPhrases };
  const extracted = { ...session.extracted, mirror };
  const receipt = MODULE_REGISTRY.mirror.receipt({ mirror: { quoted_phrases: quotedPhrases } }) ?? "";
  const modules = markModuleComplete(session, "mirror", receipt);

  await saveSession(supabase, user.id, { extracted, modules, status: "complete" });

  const profileDoc = await getProfileDoc(supabase, user.id);
  if (profileDoc) {
    const updatedDoc = {
      ...profileDoc.doc,
      "thesis.md": setThesisIntroFromMirror(profileDoc.doc["thesis.md"], paragraphs),
    };
    await upsertProfileDoc(supabase, user.id, updatedDoc);
  }

  return NextResponse.json({ ok: true, key: "mirror", receipt });
}
