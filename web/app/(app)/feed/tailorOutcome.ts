export type TailorOutcome =
  | { kind: "started"; runId: string }
  | { kind: "cooldown"; message: string }
  | { kind: "daily_limit"; message: string }
  | { kind: "budget_exceeded"; message: string }
  | { kind: "error"; message: string };

/**
 * Maps a `POST /api/tailor/run` response to the button's next state.
 * Unlike hunt's cooldown (`feed/huntOutcome.ts`'s `formatCooldownTime`),
 * tailor's 429s carry no `cooldown_until` timestamp anywhere in the route
 * response (`web/app/api/tailor/run/route.ts`) — copy here stays
 * qualitative on purpose instead of fabricating a retry clock time.
 */
export function interpretTailorResponse(
  status: number,
  body: { error?: string; count?: number; run_id?: string; ok?: boolean }
): TailorOutcome {
  if (status >= 200 && status < 300) {
    return { kind: "started", runId: body.run_id ?? "" };
  }
  if (status === 429 && body.error === "daily_limit") {
    const count = body.count ?? 0;
    return {
      kind: "daily_limit",
      message: `You've used ${count} tailor${count === 1 ? "" : "s"} today — try again tomorrow.`,
    };
  }
  if (status === 429 && body.error === "cooldown") {
    return { kind: "cooldown", message: "This posting is already generating — check back in a bit." };
  }
  if (status === 429 && body.error === "budget_exceeded") {
    return { kind: "budget_exceeded", message: "This month's shared budget is used up — try again next month." };
  }
  if (status === 503) {
    return { kind: "error", message: "Tailoring isn't configured yet — try again later." };
  }
  return { kind: "error", message: body.error ?? "Something went wrong." };
}
