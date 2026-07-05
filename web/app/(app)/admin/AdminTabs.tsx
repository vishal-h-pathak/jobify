"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Operations" },
  { href: "/admin/system", label: "System" },
];

/**
 * Mirrors ../NavLinks.tsx's pathname-active pattern, scoped to the two
 * admin tabs. Purely presentational — the actual admin gate lives in each
 * page's own requireAdmin() call, not here.
 */
export function AdminTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-6 text-sm font-medium">
      {TABS.map(({ href, label }) => {
        // "/admin" must match exactly — otherwise it would also light up
        // for "/admin/system" (which starts with "/admin/"), stealing the
        // active state from the System tab.
        const active = href === "/admin" ? pathname === href : pathname === href || pathname?.startsWith(`${href}/`);
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
