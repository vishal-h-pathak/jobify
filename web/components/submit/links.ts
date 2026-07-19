// web/components/submit/links.ts

export function kitHref(postingId: string): string {
  return `/submit/${postingId}`;
}

export function setupHref(returnTo?: string): string {
  return returnTo ? `/submit/setup?returnTo=${encodeURIComponent(returnTo)}` : "/submit/setup";
}

/**
 * DI'd exactly like onboarding's `navigateToProfile` (web/app/(app)/onboarding/page.tsx)
 * — vitest runs in the `node` environment (no `window`), so the real
 * `window.location.assign` call can only be exercised through injection.
 */
export function navigateToSetup(
  postingId: string,
  assignImpl: (url: string) => void = (url) => window.location.assign(url)
): void {
  assignImpl(setupHref(kitHref(postingId)));
}
