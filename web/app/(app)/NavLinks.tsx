"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/feed", label: "Feed" },
  { href: "/settings", label: "Settings" },
];

const ADMIN_LINK = { href: "/admin", label: "Admin" };

/**
 * `isAdmin` is computed server-side (the (app) layout) and only crosses
 * into this client component as a rendering hint — the admin routes/pages
 * never rely on this link being hidden for actual security.
 */
export function NavLinks({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const links = isAdmin ? [...LINKS, ADMIN_LINK] : LINKS;

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
