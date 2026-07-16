import yaml from "js-yaml";

export interface DealbreakersPayload {
  hard_disqualifiers: string[];
  soft_concerns: string[];
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) return null;
    items.push(entry.trim());
  }
  return items;
}

export function parseDealbreakersBody(
  body: unknown
): { ok: true; data: DealbreakersPayload } | { ok: false; error: string } {
  const hardDisqualifiers = parseStringArray((body as { hard_disqualifiers?: unknown })?.hard_disqualifiers);
  if (hardDisqualifiers === null) {
    return { ok: false, error: "hard_disqualifiers must be an array of non-empty strings" };
  }
  const softConcernsRaw = (body as { soft_concerns?: unknown })?.soft_concerns;
  const softConcerns = softConcernsRaw === undefined ? [] : parseStringArray(softConcernsRaw);
  if (softConcerns === null) {
    return { ok: false, error: "soft_concerns must be an array of non-empty strings" };
  }

  return { ok: true, data: { hard_disqualifiers: hardDisqualifiers, soft_concerns: softConcerns } };
}

export function dealbreakersReceipt(data: DealbreakersPayload): string {
  return `${data.hard_disqualifiers.length} dealbreakers`;
}

/**
 * This module owns `hard_disqualifiers` / `soft_concerns` wholesale — a
 * re-submission replaces both arrays rather than merging, since there is no
 * "section" concept for a YAML file the way there is for a markdown
 * heading. Any other top-level key in the existing doc is preserved.
 */
export function applyDealbreakersToDoc(
  doc: Record<string, string>,
  data: DealbreakersPayload
): Record<string, string> {
  const existingRaw = doc["disqualifiers.yml"];
  const existing =
    existingRaw && typeof existingRaw === "string" ? (yaml.load(existingRaw) as Record<string, unknown> | null) : null;
  const base = existing && typeof existing === "object" ? existing : {};

  const merged = {
    ...base,
    hard_disqualifiers: data.hard_disqualifiers,
    soft_concerns: data.soft_concerns,
  };

  return { ...doc, "disqualifiers.yml": yaml.dump(merged, { noRefs: true, lineWidth: -1 }) };
}
