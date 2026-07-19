import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { intakeComplete } from "@/lib/onboarding/intakeComplete";
import { getProfileDoc } from "@/lib/db/profiles";
import { deriveDossier } from "@/lib/dossier/derive";
import { dossierExportFilename, renderDossierMarkdown } from "@/lib/dossier/exportMarkdown";
import type { ModulesState } from "@/lib/onboarding/moduleRegistry";

/**
 * D5 (UX1_DESIGN.md §3): the dossier a user can leave with. Renders the
 * SAME `deriveDossier` view model `/profile` renders (never a second
 * derivation) as clean markdown. Constitution: this route touches only
 * `profiles` (via `getProfileDoc`, authed client) and `onboarding_sessions`
 * — never `application_profiles` (work-auth/self-ID/contact defaults),
 * and never the service-role admin client at all.
 */
export async function GET() {
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
  if (!(await intakeComplete(supabase, user.id))) {
    return NextResponse.json({ error: "intake_incomplete" }, { status: 409 });
  }

  const profileDoc = await getProfileDoc(supabase, user.id);
  if (!profileDoc) {
    return NextResponse.json({ error: "no profile found — finish onboarding first" }, { status: 404 });
  }

  const { data: session, error } = await supabase
    .from("onboarding_sessions")
    .select("modules, extracted")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  const modules: ModulesState = (session?.modules as ModulesState | undefined) ?? {};
  const extracted: Record<string, unknown> = session?.extracted ?? {};

  const dossier = deriveDossier({ doc: profileDoc.doc, validationStatus: profileDoc.validationStatus, modules, extracted });

  const generatedAt = new Date();
  const markdown = renderDossierMarkdown(dossier, generatedAt);
  const filename = dossierExportFilename(dossier.header.name, generatedAt);

  return new Response(markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
