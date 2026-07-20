/**
 * Maps a user's targeting tiers (+ remote acceptance) to `board_catalog`
 * tag queries via a documented keyword heuristic — pure function, no LLM
 * (planning/HUNT2_SOURCES.md §3.3). Pack = up to `cap` (default 40)
 * catalog boards; the caller (portalsSeed.ts's `seedPortalsCompanies`)
 * puts dream-company hits first and lets the pack fill the remainder.
 */

import type { CatalogBoardRef } from "../profile/portalsSeed";
import type { SlugProbeAts } from "./slugProbe";

export interface CatalogBoardInput {
  ats: SlugProbeAts;
  slug: string;
  company_name: string;
  tags: string[];
}

export interface TierPackTargeting {
  tiers: Array<{ label: string; notes?: string; reference_role?: string }>;
  remoteRequired?: boolean;
}

// Keyword -> catalog tag rules. Multiple rules can fire (a tier can match
// more than one lane); a board's relevance score is how many of the
// derived tags it carries.
const KEYWORD_TAG_RULES: Array<{ keywords: string[]; tags: string[] }> = [
  { keywords: ["infra", "platform", "sre", "site reliability", "devops", "backend"], tags: ["infra", "devtools"] },
  {
    keywords: ["frontend", "front-end", "full stack", "fullstack", "product engineer", "ui engineer"],
    tags: ["product"],
  },
  {
    keywords: ["ml", "machine learning", "ai ", " ai", "data scientist", "data engineer", "research scientist"],
    tags: ["data-ai"],
  },
  { keywords: ["fintech", "payments", "trading systems"], tags: ["fintech"] },
  { keywords: ["enterprise", "b2b"], tags: ["enterprise"] },
  { keywords: ["startup", "early stage", "early-stage"], tags: ["growth-startup"] },
  { keywords: ["faang", "big tech", "large scale", "large-scale"], tags: ["big-tech-adjacent"] },
];

export function deriveTagsFromKeywords(text: string): Set<string> {
  const lower = ` ${text.toLowerCase()} `;
  const tags = new Set<string>();
  for (const rule of KEYWORD_TAG_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      rule.tags.forEach((t) => tags.add(t));
    }
  }
  return tags;
}

const DEFAULT_CAP = 40;

/**
 * Ranks the catalog by tag-overlap with the user's targeting, filters to
 * `remote-first` when remote is required (intersect, not just a
 * preference — a remote-required user should never see an onsite-tagged
 * pack board), and returns up to `cap` boards ordered most-relevant-first.
 * When no keyword rule fires, falls back to the (remote-filtered) catalog
 * in its given order rather than returning nothing.
 */
export function computeTierPack(
  targeting: TierPackTargeting,
  catalog: CatalogBoardInput[],
  cap: number = DEFAULT_CAP
): CatalogBoardRef[] {
  const text = (targeting.tiers ?? [])
    .flatMap((t) => [t.label, t.notes, t.reference_role])
    .filter((v): v is string => Boolean(v))
    .join(" ");
  const wantedTags = deriveTagsFromKeywords(text);

  let candidates = catalog;
  if (wantedTags.size) {
    candidates = candidates.filter((b) => b.tags.some((t) => wantedTags.has(t)));
  }
  if (targeting.remoteRequired) {
    candidates = candidates.filter((b) => b.tags.includes("remote-first"));
  }

  const scored = candidates.map((b, i) => ({
    b,
    score: b.tags.filter((t) => wantedTags.has(t)).length,
    i,
  }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);

  return scored.slice(0, cap).map(({ b }) => ({ ats: b.ats, slug: b.slug, name: b.company_name }));
}
