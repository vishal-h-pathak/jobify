import type { HTMLAttributes, ReactNode } from "react";

export type CardVariant = "default" | "quiet" | "elevated";

const CARD_VARIANT_CLASSES: Record<CardVariant, string> = {
  default: "rounded-lg border border-line bg-surface p-4",
  quiet: "rounded-lg bg-surface/50 p-4",
  elevated: "rounded-lg border border-line bg-surface p-4 shadow-lg shadow-black/20",
};

export function Card({
  variant = "default",
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; children: ReactNode }) {
  return (
    <div className={`${CARD_VARIANT_CLASSES[variant]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
