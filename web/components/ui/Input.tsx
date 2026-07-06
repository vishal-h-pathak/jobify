import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const FIELD_CLASSES =
  "w-full rounded-md border border-line bg-base px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-50";

const TEXTAREA_MIN_ROWS = 3;
const TEXTAREA_MAX_ROWS = 8;
const TEXTAREA_CHARS_PER_ROW = 60;

/** Estimates the rows a textarea needs from its value alone — no DOM measurement,
 * so autosize stays a pure function of props and is testable by calling the
 * component directly, matching this file's existing test style. */
function autosizeRows(value: TextareaHTMLAttributes<HTMLTextAreaElement>["value"]): number {
  if (typeof value !== "string" || value.length === 0) return TEXTAREA_MIN_ROWS;
  const explicitLines = value.split("\n").length;
  const wrappedLines = Math.ceil(value.length / TEXTAREA_CHARS_PER_ROW);
  return Math.min(Math.max(explicitLines, wrappedLines, TEXTAREA_MIN_ROWS), TEXTAREA_MAX_ROWS);
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_CLASSES} ${className}`} {...rest} />;
}

export function TextArea({ className = "", rows, value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows ?? autosizeRows(value)}
      value={value}
      className={`${FIELD_CLASSES} ${className}`}
      {...rest}
    />
  );
}
