import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { InviteForm } from "./InviteForm";

// Signed-out visitors get redirected to /login (no dead-end error), and
// already-claimed visitors skip straight to /feed — see auth funnel spec.
export const dynamic = "force-dynamic";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const target = `/invite${code ? `?code=${encodeURIComponent(code)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(target)}`);
  }

  // Admins may never hold a claimed invite of their own (no reason to
  // spend one on yourself) — send them to /admin instead of the claim
  // form, before even checking hasClaimedInvite.
  if (isAdmin(user)) {
    redirect("/admin");
  }

  if (await hasClaimedInvite(supabase)) {
    redirect("/feed");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <InviteForm initialCode={code ?? ""} />
    </div>
  );
}
