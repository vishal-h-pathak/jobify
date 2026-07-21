const IN_PROGRESS_WINDOW_MINUTES = 30;

export type HuntButtonState =
  | { kind: "in_progress"; startedAt: string }
  | { kind: "error" }
  | { kind: "cooldown"; availableAt: string }
  | { kind: "ready" };

export interface HuntCycleForDerivation {
  started_at: string;
  finished_at: string | null;
  counters: Record<string, unknown> | null;
}

export interface ProfileForHuntDerivation {
  last_hunt_requested_at: string | null;
}

/**
 * Server-side truth for the feed's "Run my hunt" button (2026-07-21 fix):
 * previously the button's state was purely client-local, so navigating
 * away and back showed "idle" again mid-run — a double-dispatch risk.
 * This derives the real state from `profiles.last_hunt_requested_at` +
 * recent `hunt_cycles` rows on every feed load, instead.
 *
 * `hunt_cycles` carries no `user_id` (by design — see 0008_hunt_cycles.sql),
 * so the error check is necessarily best-effort: `fanout.py` stamps
 * `counters.first_error` as `"<user_id[:8]>: <traceback>"` for whichever
 * user first failed in a fan-out cycle, and a user-triggered hunt always
 * dispatches `mode: "single_user"` for exactly one user — so a prefix
 * match against this user's own id is unambiguous for that mode.
 */
export function deriveHuntButtonState(
  profile: ProfileForHuntDerivation,
  cycles: HuntCycleForDerivation[],
  userId: string,
  cooldownHours: number,
  now: Date
): HuntButtonState {
  const requestedAt = profile.last_hunt_requested_at;
  if (!requestedAt) return { kind: "ready" };

  const requestedTime = new Date(requestedAt).getTime();
  const cyclesAfterRequest = cycles.filter((c) => new Date(c.started_at).getTime() >= requestedTime);
  const finishedAfterRequest = cyclesAfterRequest.some(
    (c) => c.finished_at && new Date(c.finished_at).getTime() > requestedTime
  );

  const minutesSinceRequest = (now.getTime() - requestedTime) / 60_000;
  if (minutesSinceRequest < IN_PROGRESS_WINDOW_MINUTES && !finishedAfterRequest) {
    return { kind: "in_progress", startedAt: requestedAt };
  }

  const uuidPrefix = userId.slice(0, 8);
  const newestAfterRequest = cyclesAfterRequest.reduce<HuntCycleForDerivation | null>((newest, cycle) => {
    if (!newest) return cycle;
    return new Date(cycle.started_at).getTime() > new Date(newest.started_at).getTime() ? cycle : newest;
  }, null);
  const firstError = newestAfterRequest?.counters?.first_error;
  if (typeof firstError === "string" && firstError.startsWith(uuidPrefix)) {
    return { kind: "error" };
  }

  const cooldownUntil = new Date(requestedTime);
  cooldownUntil.setUTCHours(cooldownUntil.getUTCHours() + cooldownHours);
  if (cooldownUntil.getTime() > now.getTime()) {
    return { kind: "cooldown", availableAt: cooldownUntil.toISOString() };
  }

  return { kind: "ready" };
}

export function formatStartedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Relative form ("~2h") for the disabled cooldown note — distinct from
 * `huntOutcome.ts`'s `formatCooldownTime`, which shows an absolute clock
 * time for a freshly-triggered 429 response. */
export function formatCooldownRemaining(availableAtIso: string, now: Date): string {
  const remainingMs = new Date(availableAtIso).getTime() - now.getTime();
  const hours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
  return `~${hours}h`;
}
