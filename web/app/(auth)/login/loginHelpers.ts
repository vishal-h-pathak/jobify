const RESEND_COOLDOWN_MS = 30_000;

/** Where the callback (magic-link email click, or Google OAuth return) should send the user back to. */
export function buildAuthRedirectTo(origin: string, next: string | null): string {
  const base = `${origin}/auth/callback`;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

export function canResend(sentAt: number, now: number): boolean {
  return now - sentAt >= RESEND_COOLDOWN_MS;
}
