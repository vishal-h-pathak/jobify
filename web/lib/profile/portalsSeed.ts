/**
 * Seeds a minimal `portals.yml` from stage-3 targeting answers, following
 * `onboarding/references/portals-seeding.md`: ship empty `companies: []`
 * sections (verified slugs are a nice-to-have, not required for v1 — the
 * web interview doesn't walk the user through slug verification) plus a
 * `title_filter` whose three lists must be non-empty (schema `minItems: 1`
 * in `onboarding/schema/portals.schema.json`). Generic fallback terms are
 * appended whenever the interview yielded too little to guarantee that
 * invariant regardless of how sparse the conversation was.
 */

const GENERIC_REJECT_SUBSTRINGS = ["intern", "vp of", "recruiter", "account executive"];
const GENERIC_SENIORITY_SUBSTRINGS = ["senior", "staff", "principal", "lead"];

export interface TargetingForPortals {
  tiers: Array<{ label: string }>;
  hard_disqualifiers?: string[];
}

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

export function buildPortalsDoc(targeting: TargetingForPortals, anchorTitle?: string): Record<string, unknown> {
  return {
    greenhouse: { companies: [] },
    lever: { companies: [] },
    ashby: { companies: [] },
    workday: { companies: [] },
    title_filter: buildTitleFilter(targeting, anchorTitle),
  };
}
