import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/db/access";
import { isAdmin } from "@/lib/admin/isAdmin";
import { sanitizeNext } from "@/lib/auth/sanitizeNext";
import { SwitchAccountButton } from "@/components/auth/SwitchAccountButton";
import { InviteForm } from "./InviteForm";

// Signed-out visitors get redirected to /login (no dead-end error), and
// already-claimed visitors skip straight to /feed — see auth funnel spec.
export const dynamic = "force-dynamic";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const { code, next: rawNext } = await searchParams;
  const next = sanitizeNext(rawNext);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // AUTHFLOW: preserve both `code` and `next` through a login round-trip
  // (signed-out visitor, or a signed-in visitor switching accounts) so a
  // claim can still land the visitor on their original destination.
  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (next) params.set("next", next);
  const qs = params.toString();
  const selfTarget = `/invite${qs ? `?${qs}` : ""}`;

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(selfTarget)}`);
  }

  // Admins may never hold a claimed invite of their own (no reason to
  // spend one on yourself) — send them to /admin instead of the claim
  // form, before even checking hasClaimedInvite. An explicit safe `next`
  // still wins, matching the auth callback's own admin-default precedence.
  if (isAdmin(user)) {
    redirect(next ?? "/admin");
  }

  if (await hasAccess(supabase, user)) {
    redirect(next ?? "/feed");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <InviteForm initialCode={code ?? ""} next={next} />
      <p className="max-w-sm text-center text-sm text-ink-muted">
        Invited by email? Just sign in with that address — no code needed.
      </p>
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        Signed in as <span className="text-ink">{user.email}</span> — not you?
        <SwitchAccountButton next={selfTarget}>Switch account</SwitchAccountButton>
      </div>
    </div>
  );
}
