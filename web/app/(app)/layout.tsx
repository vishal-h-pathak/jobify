import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";
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

  const claimed = await hasClaimedInvite(supabase);
  if (!claimed) redirect("/invite");

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line px-6 py-4">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
          <Link href="/feed" className="font-semibold tracking-tight text-ink">
            jobify<span className="text-amber">.</span>
          </Link>
          <div className="flex items-center gap-6">
            <NavLinks />
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
