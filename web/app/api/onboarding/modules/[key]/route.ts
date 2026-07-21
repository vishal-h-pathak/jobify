import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { getProfileDoc, upsertProfileDoc } from "@/lib/db/profiles";
import { hasAccess } from "@/lib/db/access";
import { isStructuredModuleKey, MODULE_WRITERS } from "@/lib/onboarding/moduleWriters";
import { toIncrementalDocExtracted } from "@/lib/onboarding/moduleWriters/incrementalDocShape";
import { buildCheckpointDeps } from "@/lib/onboarding/checkpointDeps";
// V3A-1 contract (session-prompts/31_v3a_modules.md, pinned block): these
// three files are owned by the parallel session 30 (branch feat/v3a-spine)
// and don't exist yet as of this session — signatures below are the pinned
// contract verbatim. A full-repo tsc/build only goes green once 30 lands;
// integration is verified at the reviewer's merge into feat/v3a.
import { markModuleComplete } from "@/lib/onboarding/moduleRegistry";
import { applyModuleToDoc } from "@/lib/onboarding/incrementalDoc";
import { maybeFireCheckpoint } from "@/lib/onboarding/checkpoint";

/**
 * Shared handler for every zero-LLM structured intake module (values,
 * energy, environment, trajectory, dealbreakers — `anchor` and `reactions`
 * keep their own dedicated routes). Per-module payload validation and doc
 * rendering live in `moduleWriters/`; this route only owns the request
 * plumbing: auth, session read/write, and the module-completion sequence
 * from the pinned contract (markModuleComplete -> applyModuleToDoc ->
 * maybeFireCheckpoint).
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isStructuredModuleKey(key)) {
    return NextResponse.json({ error: "unknown module" }, { status: 404 });
  }

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

  const body = await request.json().catch(() => null);
  const writer = MODULE_WRITERS[key];
  const parsed = writer.parseBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const session = await getOrCreateSession(supabase, user.id);
  const extracted = { ...session.extracted, [key]: parsed.data };
  const receipt = writer.receipt(parsed.data);

  // V3A-1 contract: markModuleComplete returns the session's updated
  // `modules` jsonb (onboarding_sessions.modules — 30's migration 0011).
  const modules = markModuleComplete(session, key, receipt);

  await saveSession(supabase, user.id, { extracted, modules });

  // Structured modules can fire before the mirror-moment interview has
  // ever produced a `profiles` row (PRODUCT_VISION §2 phase II runs
  // alongside the background hunt, before phase III writes the doc) — in
  // that case there is nothing yet to apply the module's doc update to.
  const profileDoc = await getProfileDoc(supabase, user.id);
  if (profileDoc) {
    // toIncrementalDocExtracted bridges this module's pinned payload shape
    // into applyModuleToDoc's inner extracted shape — see
    // moduleWriters/incrementalDocShape.ts for why the two differ.
    const updatedDoc = applyModuleToDoc(
      profileDoc.doc,
      key,
      toIncrementalDocExtracted(key, parsed.data) as Record<string, unknown>
    );
    await upsertProfileDoc(supabase, user.id, updatedDoc);
  }

  // V3A-1 contract: maybeFireCheckpoint is idempotent + failure-safe, so no
  // try/catch is needed at the call site.
  await maybeFireCheckpoint(buildCheckpointDeps(), { ...session, extracted, modules }, user);

  return NextResponse.json({ ok: true, key, receipt });
}
