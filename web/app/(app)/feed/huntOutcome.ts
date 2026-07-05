export type HuntOutcome =
  | { kind: "running" }
  | { kind: "cooldown"; message: string }
  | { kind: "error"; message: string };

export function formatCooldownTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Maps a `POST /api/hunt/run` response to the button's next state.
 * 429 always carries `cooldown_until` (see `lib/hunt/dispatchHunt.ts`) —
 * formatted into an "available at H:MM" message here, not in the route,
 * so the exact copy lives in one place with the component that shows it.
 */
export function interpretHuntResponse(status: number, body: { error?: string; cooldown_until?: string }): HuntOutcome {
  if (status === 429) {
    return { kind: "cooldown", message: `Next hunt available at ${formatCooldownTime(body.cooldown_until ?? "")}.` };
  }
  if (status >= 200 && status < 300) return { kind: "running" };
  return { kind: "error", message: body.error ?? "Something went wrong." };
}
