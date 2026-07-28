import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/db/access";
import { isAdmin } from "@/lib/admin/isAdmin";
import { sanitizeNext } from "@/lib/auth/sanitizeNext";
import { LoginForm } from "./LoginForm";
import { SignedInPanel } from "./SignedInPanel";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = sanitizeNext(rawNext);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Mirrors the auth callback's own no-`next` default-target resolution
    // (app/auth/callback/route.ts) so "Continue" lands exactly where a
    // fresh sign-in would have.
    const target = next ?? (isAdmin(user) ? "/admin" : (await hasAccess(supabase, user)) ? "/feed" : "/invite");
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <SignedInPanel email={user.email ?? ""} continueTarget={target} next={next} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <LoginForm next={next} />
    </div>
  );
}
