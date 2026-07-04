import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBudgetCap, getMonthToDateSpend } from "@/lib/db/ledger";
import { getApiKeyInfo } from "@/lib/db/keys";
import { KeyForm } from "./KeyForm";

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

  const [spend, cap, keyInfo] = await Promise.all([
    getMonthToDateSpend(supabase, user.id),
    getBudgetCap(supabase, user.id),
    getApiKeyInfo(supabase, user.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Usage this month</h2>
        <p className="text-sm text-zinc-500">
          Pool spend:{" "}
          <span className="font-medium text-foreground">${spend.toFixed(2)}</span> of{" "}
          <span className="font-medium text-foreground">${cap.toFixed(2)}</span>
        </p>
        <p className="text-xs text-zinc-500">
          Spend on your own key (below) doesn&apos;t count against this cap.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">Bring your own Anthropic key</h2>
        <p className="text-sm text-zinc-500">
          Add your own Anthropic API key to skip the shared pool cap entirely — your rubric
          compile and match verdicts run on your key instead.
        </p>
        <KeyForm initialKeyLast4={keyInfo?.keyLast4 ?? null} />
      </section>
    </div>
  );
}
