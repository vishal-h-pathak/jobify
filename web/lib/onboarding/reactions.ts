import { upsertMarkdownSection } from "./moduleWriters/sectionHelpers";

export const MIN_REACTION_SAMPLE = 6;
export const MAX_REACTION_SAMPLE = 8;
export const REACTION_COMPLETE_THRESHOLD = 6;

export interface CandidatePosting {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  last_seen_at: string;
}

export interface PostingSummary {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
}

/** Lowercased alphanumeric tokens — "no embeddings in v1" per the session prompt. */
function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(Boolean));
}

/** Jaccard similarity between the two titles' token sets. */
export function tokenOverlapScore(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return intersection / union;
}

/**
 * Ranks candidates by title-overlap against the anchor, ties (including
 * the "no overlap at all" case) broken by recency — which is what makes
 * "pad with most-recent if the pool is thin" fall out for free: postings
 * with zero overlap still make the cut when there aren't enough good
 * matches, sorted last among themselves by how recently they were seen.
 * Already-reacted postings are excluded before ranking.
 */
export function sampleReactionPostings(params: {
  anchorTitle?: string;
  candidates: CandidatePosting[];
  reactedPostingIds: ReadonlySet<string>;
  count?: number;
}): PostingSummary[] {
  const count = params.count ?? MAX_REACTION_SAMPLE;
  const pool = params.candidates.filter((posting) => !params.reactedPostingIds.has(posting.id));
  const anchorTitle = params.anchorTitle?.trim();

  const ranked = [...pool].sort((a, b) => {
    if (anchorTitle) {
      const scoreA = tokenOverlapScore(anchorTitle, a.title ?? "");
      const scoreB = tokenOverlapScore(anchorTitle, b.title ?? "");
      if (scoreB !== scoreA) return scoreB - scoreA;
    }
    return b.last_seen_at.localeCompare(a.last_seen_at);
  });

  return ranked.slice(0, count).map((posting) => ({
    id: posting.id,
    title: posting.title ?? "",
    company: posting.company,
    location: posting.location,
  }));
}

export interface ReactionEntry {
  posting_id: string;
  title: string;
  company: string | null;
  reaction: "interested" | "not_interested";
  note?: string;
}

export function hasReachedReactionThreshold(reactions: ReactionEntry[]): boolean {
  return reactions.length >= REACTION_COMPLETE_THRESHOLD;
}

export function reactionsReceipt(reactions: ReactionEntry[]): string {
  return `${reactions.length} reactions`;
}

function describePosting(entry: ReactionEntry): string {
  const label = entry.company ? `${entry.title} @ ${entry.company}` : entry.title;
  return entry.note ? `${label} — ${entry.note}` : label;
}

const HEADING = "## Calibration — real postings reacted to";

/**
 * Pure doc-in/doc-out writer, same shape as the structured-module writers
 * in `moduleWriters/` — kept in this file since `reactions` isn't a
 * `moduleWriters/`-registered key (it has its own dedicated route, not the
 * shared `[key]` handler).
 */
export function applyReactionsToDoc(doc: Record<string, string>, reactions: ReactionEntry[]): Record<string, string> {
  const interested = reactions.filter((r) => r.reaction === "interested");
  const notInterested = reactions.filter((r) => r.reaction === "not_interested");

  const lines: string[] = [];
  lines.push("### Interested");
  lines.push(interested.length ? interested.map((r) => `- ${describePosting(r)}`).join("\n") : "- (none yet)");
  lines.push("");
  lines.push("### Not interested");
  lines.push(notInterested.length ? notInterested.map((r) => `- ${describePosting(r)}`).join("\n") : "- (none yet)");

  const thesis = upsertMarkdownSection(doc["thesis.md"] ?? "", HEADING, lines.join("\n"));
  return { ...doc, "thesis.md": thesis };
}
