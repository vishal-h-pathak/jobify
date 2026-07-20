/**
 * TRUNCATION invariant (reviewer addendum 2): any real model call whose
 * `output_tokens` exactly equals the `max_tokens` cap it was sent with
 * fails the run. Motivating live bug: `record_targeting` was decapitated
 * at the 1536-token cap — a truncated tool call / trailing text that reads
 * exactly like an empty or malformed turn downstream, with no distinct
 * signal of its own. Token count alone can't tell "the model finished
 * naturally at 1200 tokens" from "the model was cut off at exactly its
 * 1536-token cap"; comparing against the cap can.
 */

export interface TruncationEvent {
  turnIndex: number;
  outputTokens: number;
  maxTokens: number;
}

export interface InvariantResult {
  passed: boolean;
  failures: string[];
}

export function checkTruncationInvariant(events: TruncationEvent[]): InvariantResult {
  const failures = events
    .filter((e) => e.outputTokens === e.maxTokens)
    .map(
      (e) =>
        `turn ${e.turnIndex}: output_tokens (${e.outputTokens}) exactly hit the max_tokens cap (${e.maxTokens}) — the response may have been silently decapitated`
    );
  return { passed: failures.length === 0, failures };
}
