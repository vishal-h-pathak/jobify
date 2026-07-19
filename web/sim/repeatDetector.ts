/**
 * NO-REPEAT invariant (session-prompt 45, task 3): no two assistant turns
 * in a transcript may contain the same normalized question — where a
 * shared 12+-word window counts as a repeat, not just whole-message
 * equality. This alone catches both real live loops the two hotfixes in
 * `handleTurn.ts` were written against: the model (or the deterministic
 * fallback) re-asking the same thing turn after turn under a different
 * acknowledgment prefix.
 */

const DEFAULT_WINDOW_SIZE = 12;

export function normalizeAssistantText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RepeatCheckResult {
  repeated: boolean;
  matchedTurnIndex?: number;
  sharedWindow?: string;
}

function shingles(words: string[], windowSize: number): string[] {
  if (words.length < windowSize) return [];
  const result: string[] = [];
  for (let i = 0; i <= words.length - windowSize; i++) {
    result.push(words.slice(i, i + windowSize).join(" "));
  }
  return result;
}

/**
 * Checks `candidateNormalized` against every prior normalized text for a
 * repeat. Texts with fewer than `windowSize` words can't form a shingle, so
 * they're only flagged on an exact whole-text match (never on a partial
 * word overlap) — short, genuinely distinct acknowledgments must never
 * false-positive.
 */
export function findRepeatedWindow(
  priorNormalizedTexts: string[],
  candidateNormalized: string,
  windowSize: number = DEFAULT_WINDOW_SIZE
): RepeatCheckResult {
  const candidateWords = candidateNormalized.split(" ").filter(Boolean);

  if (candidateWords.length < windowSize) {
    if (candidateNormalized.length === 0) return { repeated: false };
    const matchedTurnIndex = priorNormalizedTexts.findIndex((prior) => prior === candidateNormalized);
    return matchedTurnIndex === -1 ? { repeated: false } : { repeated: true, matchedTurnIndex };
  }

  const candidateShingles = shingles(candidateWords, windowSize);
  for (let priorIdx = 0; priorIdx < priorNormalizedTexts.length; priorIdx++) {
    const priorWords = priorNormalizedTexts[priorIdx]!.split(" ").filter(Boolean);
    const priorShingles = new Set(shingles(priorWords, windowSize));
    for (const window of candidateShingles) {
      if (priorShingles.has(window)) {
        return { repeated: true, matchedTurnIndex: priorIdx, sharedWindow: window };
      }
    }
  }

  return { repeated: false };
}

export interface NoRepeatFailure {
  turnIndex: number;
  matchedTurnIndex: number;
  sharedWindow?: string;
}

export interface NoRepeatResult {
  passed: boolean;
  failures: NoRepeatFailure[];
}

/**
 * Runs the NO-REPEAT check incrementally over a full transcript of raw
 * assistant texts (in turn order), so every turn is checked against every
 * turn that came strictly before it — exactly how a repeat would surface
 * live, one turn behind the one that started it.
 */
export function checkNoRepeatInvariant(assistantTexts: string[]): NoRepeatResult {
  const normalized = assistantTexts.map(normalizeAssistantText);
  const failures: NoRepeatFailure[] = [];

  for (let turnIndex = 0; turnIndex < normalized.length; turnIndex++) {
    const priorTexts = normalized.slice(0, turnIndex);
    const result = findRepeatedWindow(priorTexts, normalized[turnIndex]!);
    if (result.repeated && result.matchedTurnIndex !== undefined) {
      failures.push({ turnIndex, matchedTurnIndex: result.matchedTurnIndex, sharedWindow: result.sharedWindow });
    }
  }

  return { passed: failures.length === 0, failures };
}
