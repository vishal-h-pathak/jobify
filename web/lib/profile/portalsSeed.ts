/**
 * Seeds a minimal `portals.yml` from stage-3 targeting answers, following
 * `onboarding/references/portals-seeding.md`: `title_filter`'s three lists
 * must be non-empty (schema `minItems: 1` in
 * `onboarding/schema/portals.schema.json`). Generic fallback terms are
 * appended whenever the interview yielded too little to guarantee that
 * invariant regardless of how sparse the conversation was.
 *
 * `buildPortalsDoc` itself stays a pure sync function — it's called on
 * every incremental onboarding turn for live preview (`incrementalDoc.ts`)
 * where network probing would be wasteful/inappropriate, so its default
 * company lists are still empty unless a caller supplies verified boards.
 * The real seed (dream-company slug-probe hits + tier pack) is assembled
 * by `seedPortalsCompanies` below and applied post-hoc — either by a
 * future onboarding-completion hook or, today, by `reseedPortals.ts`.
 */

import yaml from "js-yaml";
import { probeCompanySlug, type SlugProbeAts, type SlugProbeResult } from "../portals/slugProbe";

const GENERIC_REJECT_SUBSTRINGS = ["intern", "vp of", "recruiter", "account executive"];
const GENERIC_SENIORITY_SUBSTRINGS = ["senior", "staff", "principal", "lead"];

export interface TargetingForPortals {
  tiers: Array<{ label: string }>;
  hard_disqualifiers?: string[];
  dream_companies?: string[];
}

export interface PortalsCompanySeed {
  slug: string;
  name: string;
}

export interface CatalogBoardRef extends PortalsCompanySeed {
  ats: SlugProbeAts;
}

export type PortalsCompaniesByAts = Record<SlugProbeAts, PortalsCompanySeed[]>;

function dedupeNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

export function buildTitleFilter(
  targeting: TargetingForPortals,
  anchorTitle?: string
): {
  reject_substrings: string[];
  prefer_substrings: string[];
  seniority_substrings: string[];
} {
  const tierLabels = (targeting.tiers ?? []).map((t) => t.label).filter(Boolean);

  // ONB-A: the anchor's current_title (§2 stage 1) seeds prefer_substrings
  // alongside tier labels, so the hunter keeps polling near the anchored
  // role even before/without a full targeting conversation.
  const prefer = dedupeNonEmpty([...tierLabels, ...(anchorTitle ? [anchorTitle] : [])]);
  const reject = dedupeNonEmpty(GENERIC_REJECT_SUBSTRINGS);
  const seniority = dedupeNonEmpty(GENERIC_SENIORITY_SUBSTRINGS);

  return {
    // At least one of each list is guaranteed by the generic fallback
    // constants above, independent of interview richness.
    reject_substrings: reject.length ? reject : GENERIC_REJECT_SUBSTRINGS,
    prefer_substrings: prefer.length ? prefer : ["software engineer"],
    seniority_substrings: seniority.length ? seniority : GENERIC_SENIORITY_SUBSTRINGS,
  };
}

export function buildPortalsDoc(
  targeting: TargetingForPortals,
  anchorTitle?: string,
  companies?: PortalsCompaniesByAts
): Record<string, unknown> {
  return {
    greenhouse: { companies: companies?.greenhouse ?? [] },
    lever: { companies: companies?.lever ?? [] },
    ashby: { companies: companies?.ashby ?? [] },
    workday: { companies: [] },
    title_filter: buildTitleFilter(targeting, anchorTitle),
  };
}

/**
 * Merge-not-replace: unions two company lists by slug, existing entries
 * win on conflict. Protects a user's hand-edited/hand-seeded boards from
 * being clobbered by a later reseed.
 */
export function mergeCompaniesBySlug(
  existing: PortalsCompanySeed[] | null | undefined,
  incoming: PortalsCompanySeed[]
): PortalsCompanySeed[] {
  const bySlug = new Map<string, PortalsCompanySeed>();
  for (const c of existing ?? []) bySlug.set(c.slug, c);
  for (const c of incoming) if (!bySlug.has(c.slug)) bySlug.set(c.slug, c);
  return [...bySlug.values()];
}

function readExistingCompanies(
  doc: Record<string, unknown> | null | undefined,
  ats: SlugProbeAts
): PortalsCompanySeed[] {
  const section = doc?.[ats];
  if (!section || typeof section !== "object") return [];
  const companies = (section as Record<string, unknown>).companies;
  if (!Array.isArray(companies)) return [];
  return companies.filter((c): c is PortalsCompanySeed => {
    if (!c || typeof c !== "object") return false;
    const rec = c as Record<string, unknown>;
    return typeof rec.slug === "string" && typeof rec.name === "string";
  });
}

const DEFAULT_SEED_CAP = 40;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

export interface SeedPortalsCompaniesParams {
  targeting: TargetingForPortals;
  anchorTitle?: string;
  dreamCompanies: string[];
  /** Tier-pack boards (see tierPacks.ts), already ordered by relevance. */
  tierPackBoards?: CatalogBoardRef[];
  /** The user's current parsed portals.yml, if any — merge-not-replace base. */
  existingDoc?: Record<string, unknown> | null;
  probe?: (companyName: string) => Promise<SlugProbeResult>;
  confidenceThreshold?: number;
  seedCap?: number;
}

export interface SeedPortalsCompaniesResult {
  portalsYaml: string;
  couldntAutoFind: string[];
}

/**
 * The real seed: probes each dream company (high-confidence hits win a
 * slot), fills remaining slots up to `seedCap` from the caller's tier
 * pack, merges the result into the user's existing portals doc
 * (merge-not-replace), and re-serializes to YAML. Low-confidence/failed
 * dream-company probes are returned separately as `couldntAutoFind` for
 * the caller to persist (no UI this session — stored as a sibling doc key,
 * see `reseedPortals.ts`).
 */
export async function seedPortalsCompanies(
  params: SeedPortalsCompaniesParams
): Promise<SeedPortalsCompaniesResult> {
  const probe = params.probe ?? probeCompanySlug;
  const confidenceThreshold = params.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const seedCap = params.seedCap ?? DEFAULT_SEED_CAP;
  const dreamNames = dedupeNonEmpty(params.dreamCompanies ?? []);

  const dreamHits: CatalogBoardRef[] = [];
  const couldntAutoFind: string[] = [];

  const probeResults = await Promise.all(dreamNames.map((name) => probe(name)));
  probeResults.forEach((result, i) => {
    const name = dreamNames[i];
    if (result.found && result.confidence >= confidenceThreshold) {
      dreamHits.push({ ats: result.ats, slug: result.slug, name });
    } else {
      couldntAutoFind.push(name);
    }
  });

  const remainingCap = Math.max(0, seedCap - dreamHits.length);
  const packBoards = (params.tierPackBoards ?? []).slice(0, remainingCap);

  const byAts: PortalsCompaniesByAts = { greenhouse: [], lever: [], ashby: [] };
  for (const board of [...dreamHits, ...packBoards]) {
    byAts[board.ats].push({ slug: board.slug, name: board.name });
  }

  const mergedByAts: PortalsCompaniesByAts = {
    greenhouse: mergeCompaniesBySlug(readExistingCompanies(params.existingDoc, "greenhouse"), byAts.greenhouse),
    lever: mergeCompaniesBySlug(readExistingCompanies(params.existingDoc, "lever"), byAts.lever),
    ashby: mergeCompaniesBySlug(readExistingCompanies(params.existingDoc, "ashby"), byAts.ashby),
  };

  const doc = buildPortalsDoc(params.targeting, params.anchorTitle, mergedByAts);
  return {
    portalsYaml: yaml.dump(doc, { noRefs: true, lineWidth: -1 }),
    couldntAutoFind,
  };
}
