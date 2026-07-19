"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/feed", label: "Feed" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

const ADMIN_LINK = { href: "/admin", label: "Admin" };

export interface NavProgress {
  completed: number;
  total: number;
}

/**
 * Pure — the (app) shell's nav states (UX1_DESIGN.md §2). Incomplete intake
 * collapses the nav to a single "Your intake — N of 12" link (Feed/Profile/
 * Settings don't exist yet for this user); complete restores today's full
 * nav (V3A-B3: Feed · Profile · Settings). Admin is kept in both states —
 * the cockpit exception. Extracted so it's testable without `usePathname`.
 */
export function visibleNavLinks(
  isAdmin: boolean,
  complete: boolean,
  progress: NavProgress
): { href: string; label: string }[] {
  if (!complete) {
    const intakeLink = { href: "/onboarding", label: `Your intake — ${progress.completed} of ${progress.total}` };
    return isAdmin ? [intakeLink, ADMIN_LINK] : [intakeLink];
  }
  return isAdmin ? [...LINKS, ADMIN_LINK] : LINKS;
}

const DEFAULT_PROGRESS: NavProgress = { completed: 0, total: 12 };

/**
 * `isAdmin`/`complete`/`progress` are computed server-side (the (app)
 * layout, from `intakeComplete()` — the one source of truth) and only
 * cross into this client component as rendering hints; the gated
 * routes/pages never rely on this link being hidden for actual security.
 */
export function NavLinks({
  isAdmin = false,
  complete = true,
  progress = DEFAULT_PROGRESS,
}: {
  isAdmin?: boolean;
  complete?: boolean;
  progress?: NavProgress;
}) {
  const pathname = usePathname();
  const links = visibleNavLinks(isAdmin, complete, progress);

  return (
    <div className="flex items-center gap-6 text-sm font-medium">
      {links.map(({ href, label }) => {
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={
              active
                ? "text-ink underline decoration-amber decoration-2 underline-offset-4"
                : "text-ink-muted hover:text-ink"
            }
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
