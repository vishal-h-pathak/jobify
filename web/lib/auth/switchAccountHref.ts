/**
 * Where "switch account" (sign out, then sign back in as someone else)
 * should land — /login, preserving `next` so the visitor returns to their
 * original destination once they've signed back in.
 */
export function switchAccountHref(next: string | null): string {
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
