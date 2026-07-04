import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";

// Auth + invite gate lives here, not in proxy.ts — see
// lib/supabase/updateSession.ts for why (mirrors the papercuts pattern).
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
    <>
      <nav className="flex items-center gap-4 border-b border-zinc-200 px-6 py-3 text-sm font-medium dark:border-zinc-800">
        <Link href="/feed">Feed</Link>
        <Link href="/settings">Settings</Link>
      </nav>
      {children}
    </>
  );
}
