export interface FeedEmptyStateInput {
  totalMatches: number;
  rejectedLlmCount: number;
}

export interface FeedEmptyStateCopy {
  heading: string;
  message: string;
}

/**
 * U2 fix (session 59 — verdict quality floor, feedback item "15 surfaced
 * 'matches' scored 25-38%, most with verdict text ARGUING AGAINST the
 * job"): once stage 4 can surface FEWER than top-N, a zero-match feed
 * means two different things — "never hunted" vs "hunted, and nothing
 * cleared the bar this cycle." `rejectedLlmCount` (a real, funnel-visible
 * number now that `worth_showing: false` verdicts land there) is what
 * tells them apart; a never-hunted user has zero of both.
 *
 * Returns `null` when there's nothing to show (matches exist) — the
 * caller renders its own state for that case.
 */
export function deriveFeedEmptyState({
  totalMatches,
  rejectedLlmCount,
}: FeedEmptyStateInput): FeedEmptyStateCopy | null {
  if (totalMatches > 0) return null;

  if (rejectedLlmCount > 0) {
    return {
      heading: "Nothing worth showing yet",
      message:
        `This cycle found 0 postings worth showing you — the other ${rejectedLlmCount} ` +
        `didn't clear your bar. New postings show up as tomorrow's run comes in.`,
    };
  }

  return {
    heading: "Nothing yet",
    message: 'Your profile is built — the hunter runs when you ask. Hit "Run my hunt" above to get your first results.',
  };
}
