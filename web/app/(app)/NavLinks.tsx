"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/feed", label: "Feed" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-6 text-sm font-medium">
      {LINKS.map(({ href, label }) => {
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
