import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/db/access";
import { getProfileDoc, upsertProfileDoc } from "@/lib/db/profiles";
import { applyLogisticsToDoc } from "@/lib/dossier/applyLogisticsToDoc";

interface ProfilePatchBody {
  base?: unknown;
  remote_acceptable?: unknown;
  target_comp_usd?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The dossier's one typed-field inline edit (session-prompts/33 build item
 * 3, per V3A_DESIGN §3's one-sentence edit rule): comp floor + location/
 * remote only. Everything else on `/profile` is redo-via-module. Merges
 * into `extracted.identity.location_and_compensation`, patches the same
 * key in `profile.yml` (see applyLogisticsToDoc.ts for why that's a
 * surgical patch rather than a call through wave-1's `applyModuleToDoc` —
 * that switch has no case for this legacy-targeting-stage field), then
 * revalidates via the existing `upsertProfileDoc`.
 */
export async function PATCH(request: Request) {
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

  const body = (await request.json().catch(() => null)) as ProfilePatchBody | null;
  const patch: Record<string, unknown> = {};
  if (typeof body?.base === "string" && body.base.trim()) patch.base = body.base.trim();
  if (typeof body?.remote_acceptable === "boolean") patch.remote_acceptable = body.remote_acceptable;
  if (typeof body?.target_comp_usd === "string" && body.target_comp_usd.trim()) {
    patch.target_comp_usd = body.target_comp_usd.trim();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
  }

  const existing = await getProfileDoc(supabase, user.id);
  if (!existing) {
    return NextResponse.json({ error: "no profile found — finish onboarding first" }, { status: 404 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("onboarding_sessions")
    .select("extracted")
    .eq("user_id", user.id)
    .maybeSingle();
  if (sessionError) throw sessionError;

  const extracted = isPlainObject(session?.extracted) ? session.extracted : {};
  const identity = isPlainObject(extracted.identity) ? extracted.identity : {};
  const existingLocationAndComp = isPlainObject(identity.location_and_compensation)
    ? identity.location_and_compensation
    : {};
  const nextLocationAndComp = { ...existingLocationAndComp, ...patch };
  const nextExtracted = { ...extracted, identity: { ...identity, location_and_compensation: nextLocationAndComp } };

  const { error: updateError } = await supabase
    .from("onboarding_sessions")
    .update({ extracted: nextExtracted, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (updateError) throw updateError;

  const nextDoc = applyLogisticsToDoc(existing.doc, nextLocationAndComp);
  const validation = await upsertProfileDoc(supabase, user.id, nextDoc);

  return NextResponse.json({ ok: true, validation });
}
