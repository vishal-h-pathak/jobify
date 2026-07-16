"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/feed", label: "Feed" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

const ADMIN_LINK = { href: "/admin", label: "Admin" };

/** Pure — the (app) shell's nav order (V3A-B3: Feed · Profile · Settings
 * [· Admin]), extracted so it's testable without rendering `usePathname`. */
export function visibleNavLinks(isAdmin: boolean): typeof LINKS {
  return isAdmin ? [...LINKS, ADMIN_LINK] : LINKS;
}

/**
 * `isAdmin` is computed server-side (the (app) layout) and only crosses
 * into this client component as a rendering hint — the admin routes/pages
 * never rely on this link being hidden for actual security.
 */
export function NavLinks({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const links = visibleNavLinks(isAdmin);

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
