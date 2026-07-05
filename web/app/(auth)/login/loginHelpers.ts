const RESEND_COOLDOWN_MS = 30_000;

/** Where the magic-link email should send the user back to. */
export function buildEmailRedirectTo(origin: string, next: string | null): string {
  const base = `${origin}/auth/callback`;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

export function canResend(sentAt: number, now: number): boolean {
  return now - sentAt >= RESEND_COOLDOWN_MS;
}
