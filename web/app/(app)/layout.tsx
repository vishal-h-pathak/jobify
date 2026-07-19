import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { HandoffEmitter } from "@/components/extension/HandoffEmitter";
import { NavLinks } from "./NavLinks";
import { SignOutButton } from "./SignOutButton";

// Auth + invite gate lives here, not in proxy.ts — see
// lib/supabase/updateSession.ts for why (mirrors a proven magic-link pattern).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Admins bypass the invite gate — they may not hold a claimed code.
  const admin = isAdmin(user);
  const claimed = admin || (await hasClaimedInvite(supabase));
  if (!claimed) redirect("/invite");

  return (
    <div className="flex min-h-full flex-col">
      <HandoffEmitter />
      <header className="border-b border-line px-6 py-4">
        {/* Width decision (ONBOARDING_REDESIGN.md §1.9/§3): the app shell standardizes
            on max-w-3xl, matching /feed (web/app/(app)/feed/page.tsx:77). Onboarding
            (owned by ONB-B, web/app/(app)/onboarding/page.tsx:276,283) currently
            renders at max-w-2xl — it should adopt max-w-3xl too, to stop the width
            jitter between routes that the redesign spec calls out. */}
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
          <Link href="/feed" className="font-semibold tracking-tight text-ink">
            jobify<span className="text-amber">.</span>
          </Link>
          <div className="flex items-center gap-6">
            <NavLinks isAdmin={admin} />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="border-t border-line px-6 py-4 text-center text-sm text-ink-muted">
        jobify — a private beta for friends
      </footer>
    </div>
  );
}
