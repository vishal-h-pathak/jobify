/**
 * Best-effort $/token rates for `cost_usd` on each `budget_ledger` insert.
 * No cost-rail convention exists elsewhere in this repo yet (H6 owns
 * getting this precise, incl. prompt-caching discounts and BYO-key
 * accounting) — this table is intentionally isolated to one place so it's
 * a one-line update if pricing or the configured model changes. Falls
 * back to $0 (tokens are still recorded accurately even if the rate is
 * unknown) rather than guessing.
 */
const USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
};

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = USD_PER_MILLION_TOKENS[model];
  if (!rate) return 0;
  const cost = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
