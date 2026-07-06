import Link from "next/link";
import { redirect } from "next/navigation";
import { BUTTON_VARIANT_CLASSES } from "@/components/ui/Button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";

const LINK_BUTTON_BASE = "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium";

// Signed-in visitors with a claimed invite skip the pitch entirely.
export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && (await hasClaimedInvite(supabase))) {
    redirect("/feed");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-ink">
          jobify<span className="text-amber">.</span>
        </h1>
        <p className="max-w-md text-xl font-medium tracking-tight text-ink">
          a job feed that actually knows you
        </p>
      </div>

      <ol className="max-w-md list-decimal list-inside space-y-2 text-left text-sm text-ink-muted">
        <li>A short interview about what you&apos;re actually looking for.</li>
        <li>A feed scored against that, whenever you ask — not keyword soup.</li>
        <li>Reasons for every match, so you know why it&apos;s there.</li>
      </ol>

      <p className="max-w-sm text-sm text-ink-muted">
        Private beta — you&apos;ll need an invite to get in.
      </p>

      <div className="flex items-center gap-4">
        <Link href="/invite" className={`${LINK_BUTTON_BASE} ${BUTTON_VARIANT_CLASSES.primary}`}>
          I have an invite
        </Link>
        <Link href="/login" className={`${LINK_BUTTON_BASE} ${BUTTON_VARIANT_CLASSES.ghost}`}>
          Sign in
        </Link>
      </div>
    </div>
  );
}
