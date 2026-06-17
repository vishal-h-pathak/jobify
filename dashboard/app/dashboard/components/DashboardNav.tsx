"use client";

/**
 * DashboardNav — global nav for the dashboard surface.
 *
 * Same chrome as the notebook nav: sticky, near-black with backdrop
 * blur, hairline bottom rule, mono links, green pulse-dot brand. The
 * active link underlines amber (the dashboard is a bench/build
 * surface). The Review queue badge counts rows needing a human.
 *
 * Self-fetches its own action-needed count (rows where status is
 * `ready_for_review`) so callers don't have to thread it through
 * props. Polls every 30s while the tab is visible to keep the badge
 * fresh.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SITE_NAME } from "@/site.config";

const ACTION_REFRESH_MS = 30_000;

type NavItem = {
  href: string;
  label: string;
  isActive: (path: string) => boolean;
  badge?: (n: number) => boolean;
};

const ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    // Active for the bare /dashboard route only — nested routes have
    // their own nav items.
    isActive: (p) => p === "/dashboard",
  },
  {
    href: "/dashboard/review",
    label: "Review",
    isActive: (p) => p.startsWith("/dashboard/review"),
    badge: (n) => n > 0,
  },
];

export default function DashboardNav({
  rightSlot,
}: {
  /**
   * Optional right-aligned slot. The dashboard route uses it for the
   * browse/swipe view-mode toggle; other routes leave it empty.
   */
  rightSlot?: ReactNode;
}) {
  const path = usePathname() ?? "";
  const [actionCount, setActionCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const res = await fetch("/api/dashboard/jobs/action-count", {
          cache: "no-store",
        });
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as { count?: number };
        setActionCount(json.count ?? 0);
      } catch {
        // Failures here are non-fatal — the nav still renders without
        // the badge, and the next poll will retry.
      }
    };

    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), ACTION_REFRESH_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <nav className="sticky top-0 z-30 border-b border-rule bg-[rgba(11,11,12,0.92)] backdrop-blur-[8px]">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-5 overflow-x-auto px-4 sm:px-8">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink transition-colors duration-150 hover:text-green"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-green motion-safe:animate-pulse"
          />
          {SITE_NAME}
        </Link>
        <ul className="flex items-center gap-4">
          {ITEMS.map((item) => {
            const active = item.isActive(path);
            const showBadge =
              item.badge !== undefined &&
              actionCount !== null &&
              item.badge(actionCount);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "inline-flex items-baseline gap-1.5 border-b py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 " +
                    (active
                      ? "border-amber text-ink"
                      : "border-transparent text-ink-faint hover:text-ink")
                  }
                >
                  <span>{item.label}</span>
                  {showBadge && (
                    <span
                      className="border border-amber-dim px-1.5 text-[10px] text-amber tabular-nums"
                      aria-label={`${actionCount} action(s) needed`}
                    >
                      {actionCount}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {rightSlot}
        </div>
      </div>
    </nav>
  );
}
