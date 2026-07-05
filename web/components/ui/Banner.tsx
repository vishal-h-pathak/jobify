import type { ReactNode } from "react";

export type BannerTone = "info" | "warn" | "danger";

const TONE_CLASSES: Record<BannerTone, string> = {
  info: "border-badge-blue/30 bg-badge-blue/10",
  warn: "border-amber/30 bg-amber/10",
  danger: "border-danger/40 bg-danger/10",
};

export function Banner({
  tone = "info",
  className = "",
  children,
}: {
  tone?: BannerTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="alert" className={`rounded-lg border p-4 text-sm text-ink ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </div>
  );
}
