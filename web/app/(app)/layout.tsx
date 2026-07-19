import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { intakeComplete } from "@/lib/onboarding/intakeComplete";
import { deriveWelcomeBack } from "@/lib/onboarding/welcomeBack";
import { completedModuleCount, CANONICAL_MODULE_ORDER } from "@/components/onboarding/moduleOrder";
import type { InterviewStage } from "@/components/onboarding/moduleOrder";
import type { ModulesState } from "@/lib/onboarding/moduleRegistry";
import { HandoffEmitter } from "@/components/extension/HandoffEmitter";
import { NavLinks, type NavProgress } from "./NavLinks";
import { SignOutButton } from "./SignOutButton";
import { WelcomeBackProvider } from "./WelcomeBackContext";

// Auth + invite gate lives here, not in proxy.ts — see
// lib/supabase/updateSession.ts for why (mirrors a proven magic-link pattern).
export const dynamic = "force-dynamic";

/** UX1_DESIGN.md §2: the gate excludes `/onboarding` itself from the redirect. */
function isUnderOnboarding(pathname: string): boolean {
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}

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

  const complete = await intakeComplete(supabase, user.id);

  let progress: NavProgress = { completed: 0, total: CANONICAL_MODULE_ORDER.length };
  let welcomeBack = null;

  if (!complete) {
    const { data: session, error } = await supabase
      .from("onboarding_sessions")
      .select("modules, stage, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    const modules = (session?.modules ?? {}) as ModulesState;
    const stage = (session?.stage ?? "anchor") as InterviewStage;
    progress = { completed: completedModuleCount(modules, stage), total: CANONICAL_MODULE_ORDER.length };
    welcomeBack = deriveWelcomeBack(modules, stage, session?.updated_at ?? null, new Date());

    const pathname = (await headers()).get("x-pathname") ?? "";
    if (!isUnderOnboarding(pathname)) redirect("/onboarding");
  }

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
            <NavLinks isAdmin={admin} complete={complete} progress={progress} />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <WelcomeBackProvider value={welcomeBack}>{children}</WelcomeBackProvider>
      </main>
      <footer className="border-t border-line px-6 py-4 text-center text-sm text-ink-muted">
        jobify — a private beta for friends
      </footer>
    </div>
  );
}
