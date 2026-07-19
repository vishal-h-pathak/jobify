import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBudgetCap, getMonthToDateSpend } from "@/lib/db/ledger";
import { getApiKeyInfo } from "@/lib/db/keys";
import { getProfileDoc } from "@/lib/db/profiles";
import { deriveCvProvenance } from "@/lib/settings/cvProvenance";
import { KeyForm } from "./KeyForm";
import { ResumeForm } from "./ResumeForm";
import { ApplicationDefaultsCard } from "@/components/submit/ApplicationDefaultsCard";

const PROVENANCE_COPY = {
  resume: "Your profile's resume is from the resume you provided.",
  interview: "Your profile's resume was built from your interview answers.",
  none: "No resume on file yet — upload one below and it becomes the source for your dossier and every tailored application.",
} as const;

// Reads the signed-in user's own budget/key rows on every request — cost
// data changes as the worker runs, so this page shouldn't be statically
// cached. The (app) layout already gates auth + the invite check.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [spend, cap, keyInfo, profile] = await Promise.all([
    getMonthToDateSpend(supabase, user.id),
    getBudgetCap(supabase, user.id),
    getApiKeyInfo(supabase, user.id),
    getProfileDoc(supabase, user.id),
  ]);

  const spendPct = cap > 0 ? Math.min(100, (spend / cap) * 100) : 0;
  const cvProvenance = deriveCvProvenance(profile?.doc);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Settings</h1>

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium text-ink">Usage this month</h2>
        <p className="text-sm text-ink-muted">
          Pool spend: <span className="font-medium text-ink">${spend.toFixed(2)}</span> of{" "}
          <span className="font-medium text-ink">${cap.toFixed(2)}</span>
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-amber transition-[width]" style={{ width: `${spendPct}%` }} />
        </div>
        <p className="text-xs text-ink-muted">Spend on your own key (below) doesn&apos;t count against this cap.</p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium text-ink">Bring your own Anthropic key</h2>
        <p className="text-sm text-ink-muted">
          Add your own Anthropic API key to skip the shared pool cap entirely — your rubric
          compile and match verdicts run on your key instead.
        </p>
        <KeyForm initialKeyLast4={keyInfo?.keyLast4 ?? null} />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium text-ink">Resume</h2>
        <p className="text-sm text-ink-muted">{PROVENANCE_COPY[cvProvenance]}</p>
        <ResumeForm />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium text-ink">Application defaults</h2>
        <p className="text-sm text-ink-muted">
          Contact info, work authorization, logistics, and voluntary self-identification — used to fill every submit
          kit automatically.
        </p>
        <ApplicationDefaultsCard />
      </section>
    </div>
  );
}
