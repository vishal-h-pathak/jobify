import { upsertMarkdownSection, bulletList } from "./sectionHelpers";

// PRODUCT_VISION.md §2.3 / session-prompts/31_v3a_modules.md task 2: the
// seven forced trade-off pairs, defined server-side (never client-supplied)
// so the payload can be validated against a known id set.
export const VALUE_PAIRS = [
  { pair_id: "mission_prestige", a: "Mission-driven work", b: "Prestige / brand name" },
  { pair_id: "hours_equity", a: "Predictable 40 hours", b: "Variable 50 + equity upside" },
  { pair_id: "specialist_generalist", a: "Deep specialist", b: "Broad generalist" },
  { pair_id: "autonomy_mentorship", a: "High autonomy", b: "Structured mentorship" },
  { pair_id: "stability_upside", a: "Stability", b: "Upside risk" },
  { pair_id: "ic_leadership", a: "Individual-contributor track", b: "Leadership track" },
  { pair_id: "remote_in_person", a: "Remote energy", b: "In-person energy" },
] as const;

const VALUE_PAIR_IDS = new Set(VALUE_PAIRS.map((pair) => pair.pair_id));
const MIN_CHOICES = 6;
const MAX_CHOICES = VALUE_PAIRS.length;

export interface ValueChoice {
  pair_id: string;
  choice: "a" | "b";
}

export type ValuesPayload = ValueChoice[];

export function parseValuesBody(body: unknown): { ok: true; data: ValuesPayload } | { ok: false; error: string } {
  if (!Array.isArray(body)) {
    return { ok: false, error: "body must be an array of {pair_id, choice}" };
  }
  if (body.length < MIN_CHOICES || body.length > MAX_CHOICES) {
    return { ok: false, error: `expected ${MIN_CHOICES}-${MAX_CHOICES} choices, got ${body.length}` };
  }

  const seen = new Set<string>();
  const choices: ValuesPayload = [];
  for (const entry of body) {
    const pairId = typeof entry?.pair_id === "string" ? entry.pair_id : null;
    const choice = entry?.choice;
    if (!pairId || !VALUE_PAIR_IDS.has(pairId)) {
      return { ok: false, error: `unknown pair_id: ${String(pairId)}` };
    }
    if (seen.has(pairId)) {
      return { ok: false, error: `duplicate pair_id: ${pairId}` };
    }
    if (choice !== "a" && choice !== "b") {
      return { ok: false, error: `choice must be "a" or "b" for pair_id ${pairId}` };
    }
    seen.add(pairId);
    choices.push({ pair_id: pairId, choice });
  }

  return { ok: true, data: choices };
}

export function valuesReceipt(data: ValuesPayload): string {
  return `${data.length} trade-offs chosen`;
}

const HEADING = "## What matters (chosen under trade-off)";

export function applyValuesToDoc(doc: Record<string, string>, data: ValuesPayload): Record<string, string> {
  const chosenLabels = data.map((entry) => {
    const pair = VALUE_PAIRS.find((p) => p.pair_id === entry.pair_id);
    const label = pair ? (entry.choice === "a" ? pair.a : pair.b) : entry.pair_id;
    return label;
  });
  const thesis = upsertMarkdownSection(doc["thesis.md"] ?? "", HEADING, bulletList(chosenLabels));
  return { ...doc, "thesis.md": thesis };
}
