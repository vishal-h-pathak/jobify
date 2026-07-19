"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BUTTON_VARIANT_CLASSES } from "@/components/ui/Button";
import { fetchApplicationProfile } from "./api";
import { setupHref } from "./links";
import type { ApplicationProfile } from "./types";

export function describeProfileStatus(profile: ApplicationProfile | null): string {
  if (!profile) return "Not set up yet.";
  if (!profile.updated_at) return "Saved.";
  const date = new Date(profile.updated_at);
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Last updated ${formatted}.`;
}

export function ApplicationDefaultsCard() {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApplicationProfile()
      .then((profile) => {
        if (!cancelled) setStatus(describeProfileStatus(profile));
      })
      .catch(() => {
        if (!cancelled) setStatus("Couldn't load your application defaults — try refreshing.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-ink-muted">{status ?? "Loading…"}</p>
      <Link
        href={setupHref("/settings")}
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${BUTTON_VARIANT_CLASSES.secondary}`}
      >
        Edit
      </Link>
    </div>
  );
}
