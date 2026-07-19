import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProfileDoc } from "@/lib/db/profiles";
import { deriveDossier } from "@/lib/dossier/derive";
import { renderDossierCopyBlock } from "@/lib/dossier/exportMarkdown";
import { DossierView } from "@/components/dossier/DossierView";
import type { ModulesState } from "@/lib/onboarding/moduleRegistry";

// Per-user live read, not cacheable — matches the (app) layout's own
// `force-dynamic` and /feed's pattern (app/(app)/feed/page.tsx).
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // No profiles row yet == onboarding never finished (the row is only
  // written by onboarding's checkpoint/completion writes) -> warm redirect,
  // never a broken page (session-prompts/33 build item 4).
  const profileDoc = await getProfileDoc(supabase, user.id);
  if (!profileDoc) redirect("/onboarding");

  const { data: session, error } = await supabase
    .from("onboarding_sessions")
    .select("modules, extracted")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  const modules: ModulesState = (session?.modules as ModulesState | undefined) ?? {};
  const extracted: Record<string, unknown> = session?.extracted ?? {};

  const dossier = deriveDossier({
    doc: profileDoc.doc,
    validationStatus: profileDoc.validationStatus,
    modules,
    extracted,
  });

  const copyBlock = renderDossierCopyBlock(dossier, new Date());

  return (
    <div className="dossier-print mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <DossierView dossier={dossier} copyBlock={copyBlock} />
    </div>
  );
}
