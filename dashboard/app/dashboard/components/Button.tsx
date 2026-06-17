"use client";

/**
 * Button primitives — the register's single action language.
 *
 * Visually these are the notebook's .btn spec (mono, small, tracked,
 * 1px hairline, square corners, transparent fill) with dashboard
 * semantics layered on:
 *
 *   - primary    amber — the bench/build accent; main CTA, hover fills
 *   - approve    green — live/positive accent; approve/confirm actions
 *   - submit     blue — the third lane action; enqueue a tailored row
 *                for the local submit runner (approve→tailor→submit)
 *   - secondary  hairline + dim ink; hover warms to amber
 *   - danger     red — destructive / loses work
 *   - ghost      borderless text action (Undo, Restore, dismiss)
 *
 * Interaction contract (the "no dead clicks" fix):
 *   - pressed state applies within one frame (`active:duration-0`)
 *   - `pending` dims the label under a centered pulsing dot — same box,
 *     zero layout shift — and disables the button
 *   - `flash` overlays a green tick for ~1.2s after success
 *   Drive pending/flash from useOptimisticAction.
 */

import type { ComponentProps, ReactNode } from "react";

type Size = "sm" | "md";
export type BtnVariant =
  | "primary"
  | "approve"
  | "submit"
  | "secondary"
  | "danger"
  | "ghost";

const BASE =
  "relative inline-flex items-center justify-center gap-1.5 border " +
  "font-mono uppercase tracking-[0.12em] select-none " +
  "transition-colors duration-150 active:duration-0 " +
  "disabled:opacity-40 disabled:pointer-events-none";

const SIZES: Record<Size, string> = {
  sm: "text-[10px] px-3 py-1.5",
  md: "text-[11px] px-4 py-2",
};

const VARIANTS: Record<BtnVariant, string> = {
  primary:
    "border-amber text-amber hover:bg-amber hover:text-bg " +
    "active:bg-amber active:text-bg",
  approve:
    "border-green text-green hover:bg-green hover:text-bg " +
    "active:bg-green active:text-bg",
  submit:
    "border-blue text-blue hover:bg-blue hover:text-bg " +
    "active:bg-blue active:text-bg",
  secondary:
    "border-rule text-ink-dim hover:border-amber hover:text-amber " +
    "active:border-amber active:text-amber",
  danger:
    "border-red-dim text-red hover:border-red hover:bg-red/10 " +
    "active:bg-red/20",
  ghost:
    "border-transparent text-ink-faint hover:text-ink active:text-ink",
};

function btnClass(
  variant: BtnVariant,
  size: Size,
  extra?: string,
): string {
  return [BASE, SIZES[size], VARIANTS[variant], extra ?? ""].join(" ").trim();
}

function StateOverlay({
  pending,
  flash,
}: {
  pending?: boolean;
  flash?: boolean;
}) {
  if (!pending && !flash) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 flex items-center justify-center"
    >
      {pending ? (
        <span className="h-1.5 w-1.5 bg-current motion-safe:animate-pulse" />
      ) : (
        <span className="text-green">✓</span>
      )}
    </span>
  );
}

export type BtnProps = ComponentProps<"button"> & {
  variant?: BtnVariant;
  size?: Size;
  /** Request in flight — dims label, shows pulsing dot, disables. */
  pending?: boolean;
  /** Brief success tick (drive from useOptimisticAction.isFlashing). */
  flash?: boolean;
};

export function Btn({
  variant = "secondary",
  size = "sm",
  pending,
  flash,
  className,
  children,
  disabled,
  ...rest
}: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={btnClass(variant, size, className)}
    >
      <span className={pending || flash ? "opacity-25" : undefined}>
        {children}
      </span>
      <StateOverlay pending={pending} flash={flash} />
    </button>
  );
}

/** Anchor with identical visuals, for href actions (PDFs, postings). */
export function BtnLink({
  variant = "secondary",
  size = "sm",
  className,
  children,
  ...rest
}: ComponentProps<"a"> & {
  variant?: BtnVariant;
  size?: Size;
  children?: ReactNode;
}) {
  return (
    <a {...rest} className={btnClass(variant, size, className)}>
      {children}
    </a>
  );
}

/** Class string for Next.js <Link> elements that must look like a Btn. */
export function btnLinkClass(
  variant: BtnVariant = "secondary",
  size: Size = "sm",
  extra?: string,
): string {
  return btnClass(variant, size, extra);
}
