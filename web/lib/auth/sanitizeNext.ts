/**
 * The one place that validates a `next` redirect target: same-origin
 * relative paths only. `https://evil.com` and `//evil.com` (protocol-
 * relative) both resolve off-host if concatenated onto `${origin}`, so
 * both are rejected — every consumer of a `next` query param routes
 * through this instead of re-deriving the check.
 */
export function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}
