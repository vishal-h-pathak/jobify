import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger-ghost";

/** Shared with FileButton so its label-as-button look matches exactly. */
export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-amber text-base hover:bg-amber-hover",
  secondary: "border border-line bg-surface text-ink hover:border-ink-muted",
  ghost: "text-ink-muted hover:text-ink",
  "danger-ghost": "text-danger hover:text-danger/80",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  busy?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  busy = false,
  disabled = false,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {busy && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
