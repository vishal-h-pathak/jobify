import yaml from "js-yaml";
import { buildPortalsDoc, type TargetingForPortals } from "../profile/portalsSeed";
import { DOC_FILENAMES } from "../profile/buildDoc";
import type { ModuleKey } from "./moduleRegistry";

/**
 * V3A-1's architectural change from v2: the `profiles.doc` eight-file
 * contract is assembled INCREMENTALLY as onboarding modules complete, not
 * only once at the end. `buildMinimalDoc` produces the first, minimal-but-
 * valid doc from phase 1 alone (fired by `checkpoint.ts`); `applyModuleToDoc`
 * is the same pure updater later modules (31's writers) call as they land,
 * one module at a time, against an already-existing doc.
 *
 * Both entry points share one set of per-module doc-section builders below
 * — there is exactly one place that knows how to render "values" or
 * "reactions" into the doc, called identically whether it's the first
 * write or the fortieth.
 */

// ── module-shaped extracted data (loosely typed per moduleRegistry's
// `Record<string, unknown>` receipts — these interfaces document the shape
// each `applyModuleToDoc` case expects, not a pinned contract) ────────────

export interface AnchorExtracted {
  current_title?: string;
  current_company?: string;
  years_in_role?: string;
  free_text?: string;
}

export interface ReactionExtracted {
  posting_id: string;
  title?: string;
  company?: string;
  reaction: "interested" | "not_interested";
  note?: string;
}

export interface ValueChoiceExtracted {
  prompt: string;
  chosen: string;
  other?: string;
}

export interface DealbreakersExtracted {
  hard_disqualifiers: string[];
  soft_concerns?: string[];
  degree_gate?: string;
}

export interface EnergyExtracted {
  hours_disappear?: string;
  kept_putting_off?: string;
}

export interface EnvironmentChoiceExtracted {
  scenario: string;
  chosen: string;
}

export interface TrajectoryExtracted {
  direction: "climb" | "switch" | "stabilize" | "experiment";
  note?: string;
}

export interface MinimalDocInput {
  anchor?: AnchorExtracted;
  reactions?: ReactionExtracted[];
  values?: ValueChoiceExtracted[];
  dealbreakers?: DealbreakersExtracted;
}

// ── yaml helpers ──────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseYamlObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const parsed = yaml.load(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function dumpYaml(value: unknown): string {
  return yaml.dump(value, { noRefs: true, lineWidth: -1 });
}

const PROFILE_HEADER =
  "# profile.yml — generated incrementally by the v3a onboarding module spine.\n" +
  "# Each module's applyModuleToDoc call refreshes only the fields it owns;\n" +
  "# see web/lib/onboarding/incrementalDoc.ts.\n\n";

// v1's BLANK_APPLICATION_DEFAULTS shape (web/lib/profile/buildDoc.ts), kept
// as a small local literal rather than importing a private, unexported
// const across an ownership boundary this session doesn't otherwise touch.
const BLANK_APPLICATION_DEFAULTS = {
  work_authorization: "",
  visa_sponsorship_needed: false,
  earliest_start_date: "",
  relocation_willingness: "",
  in_person_willingness: "",
  ai_policy_ack: "",
  previous_interview_with_company: {},
};

function refreshPortalsYaml(doc: Record<string, string>): string {
  const profile = parseYamlObject(doc["profile.yml"] ?? "");
  const disq = parseYamlObject(doc["disqualifiers.yml"] ?? "");
  const whatHeIsLookingFor = isPlainObject(profile.what_he_is_looking_for) ? profile.what_he_is_looking_for : {};
  const tiers = Object.values(whatHeIsLookingFor)
    .filter(isPlainObject)
    .map((tier) => ({ label: typeof tier.label === "string" ? tier.label : "" }))
    .filter((tier) => tier.label);
  const targeting: TargetingForPortals = {
    tiers,
    hard_disqualifiers: Array.isArray(disq.hard_disqualifiers) ? (disq.hard_disqualifiers as string[]) : undefined,
  };
  return dumpYaml(buildPortalsDoc(targeting));
}

function buildCvStub(anchor?: AnchorExtracted): string {
  const title = anchor?.current_title?.trim();
  const company = anchor?.current_company?.trim();
  const roleLine = title && company ? `${title} — ${company}` : title || anchor?.free_text?.trim() || "Background";
  return `# CV — pending evidence module (no resume provided yet)\n\n## ${roleLine}\n`;
}

// ── thesis.md: parsed as an intro paragraph + an ordered set of `## `
// sections keyed by heading, so applying a module's section is a pure,
// idempotent upsert-by-heading rather than string concatenation that would
// duplicate a section on re-submission ────────────────────────────────────

const THESIS_TITLE = "# Hunting thesis";

interface ThesisModel {
  intro: string;
  sections: Map<string, string[]>;
  order: string[];
}

function parseThesis(markdown: string): ThesisModel {
  const sections = new Map<string, string[]>();
  const order: string[] = [];
  const introLines: string[] = [];
  let current: string | null = null;

  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      if (!sections.has(current)) {
        sections.set(current, []);
        order.push(current);
      }
      continue;
    }
    if (/^#\s+/.test(line)) continue; // top-level title, re-emitted by serializeThesis
    if (current) sections.get(current)!.push(line);
    else introLines.push(line);
  }

  return { intro: introLines.join("\n").trim(), sections, order };
}

function serializeThesis(model: ThesisModel): string {
  const parts = [THESIS_TITLE];
  if (model.intro) parts.push("", model.intro);
  for (const heading of model.order) {
    const body = (model.sections.get(heading) ?? []).join("\n").trim();
    parts.push("", `## ${heading}`, "", body);
  }
  return parts.join("\n").trim() + "\n";
}

function upsertThesisSection(markdown: string, heading: string, lines: string[]): string {
  const model = parseThesis(markdown || THESIS_TITLE);
  if (!model.sections.has(heading)) model.order.push(heading);
  model.sections.set(heading, lines);
  return serializeThesis(model);
}

function setThesisIntro(markdown: string, intro: string): string {
  const model = parseThesis(markdown || THESIS_TITLE);
  model.intro = intro;
  return serializeThesis(model);
}

function buildThesisIntro(anchor?: AnchorExtracted): string {
  if (!anchor) return "Hunting judgment — profile in progress.";
  const role =
    anchor.current_title && anchor.current_company
      ? `${anchor.current_title} at ${anchor.current_company}`
      : anchor.current_title || anchor.free_text || "an unspecified role";
  return `Hunting judgment for a candidate currently in ${role}.`;
}

// ── per-module apply functions ────────────────────────────────────────────

function applyAnchor(doc: Record<string, string>, anchor: AnchorExtracted): Record<string, string> {
  const profile = parseYamlObject(doc["profile.yml"] ?? "");
  const title = anchor.current_title?.trim();
  // "what_he_is_looking_for"'s label seeds the hunt's title_filter
  // prefer_substrings (see refreshPortalsYaml) — it must stay a bare role
  // title, not "title — company", or the substring match against posting
  // titles never fires. Current employer has no place in "what he's
  // looking for" anyway.
  const label = title || anchor.free_text?.trim() || "Primary role";

  const nextProfile = {
    ...profile,
    identity: { name: "", email: "", ...(isPlainObject(profile.identity) ? profile.identity : {}) },
    application_defaults: profile.application_defaults ?? BLANK_APPLICATION_DEFAULTS,
    what_he_is_looking_for: {
      ...(isPlainObject(profile.what_he_is_looking_for) ? profile.what_he_is_looking_for : {}),
      primary: { label },
    },
  };

  const nextDoc: Record<string, string> = {
    ...doc,
    "profile.yml": PROFILE_HEADER + dumpYaml(nextProfile),
    "cv.md": doc["cv.md"]?.trim() ? doc["cv.md"] : buildCvStub(anchor),
    "thesis.md": setThesisIntro(doc["thesis.md"] ?? "", buildThesisIntro(anchor)),
  };
  nextDoc["portals.yml"] = refreshPortalsYaml(nextDoc);
  return nextDoc;
}

function applyDealbreakers(doc: Record<string, string>, extracted: DealbreakersExtracted): Record<string, string> {
  const hardDisqualifiers = extracted.hard_disqualifiers ?? [];
  const softConcerns = extracted.soft_concerns ?? [];

  const lines: string[] = [];
  for (const item of hardDisqualifiers) lines.push(`- ${item}`);
  for (const item of softConcerns) lines.push(`- (soft concern) ${item}`);
  if (extracted.degree_gate) lines.push(`- Degree gate: ${extracted.degree_gate}`);

  const nextDoc: Record<string, string> = {
    ...doc,
    "disqualifiers.yml": dumpYaml({ hard_disqualifiers: hardDisqualifiers, soft_concerns: softConcerns }),
    "thesis.md": upsertThesisSection(
      doc["thesis.md"] ?? "",
      "Hard constraints",
      lines.length ? lines : ["- none stated"]
    ),
  };
  nextDoc["portals.yml"] = refreshPortalsYaml(nextDoc);
  return nextDoc;
}

function applyValues(doc: Record<string, string>, extracted: { choices?: ValueChoiceExtracted[] }): Record<string, string> {
  const choices = extracted.choices ?? [];
  const lines = choices.length
    ? choices.map((c) => `- **${c.prompt}**: chose ${c.chosen}${c.other ? ` over ${c.other}` : ""}`)
    : ["- no trade-offs answered yet"];
  return {
    ...doc,
    "thesis.md": upsertThesisSection(doc["thesis.md"] ?? "", "What matters (chosen under trade-off)", lines),
  };
}

function applyReactions(doc: Record<string, string>, extracted: { reactions?: ReactionExtracted[] }): Record<string, string> {
  const reactions = extracted.reactions ?? [];
  const lines = reactions.length
    ? reactions.map((r) => {
        const label = r.reaction === "interested" ? "Interested" : "Passed";
        const target = [r.title, r.company].filter(Boolean).join(" — ");
        return `- ${label}${target ? `: ${target}` : ""}${r.note ? ` (${r.note})` : ""}`;
      })
    : ["- no reactions recorded yet"];
  return { ...doc, "thesis.md": upsertThesisSection(doc["thesis.md"] ?? "", "Calibration examples", lines) };
}

function applyEnergy(doc: Record<string, string>, extracted: EnergyExtracted): Record<string, string> {
  const lines: string[] = [];
  if (extracted.hours_disappear) lines.push(`- Hours disappear into: ${extracted.hours_disappear}`);
  if (extracted.kept_putting_off) lines.push(`- Kept putting off: ${extracted.kept_putting_off}`);
  return {
    ...doc,
    "thesis.md": upsertThesisSection(
      doc["thesis.md"] ?? "",
      "Energy signals",
      lines.length ? lines : ["- no energy signals recorded yet"]
    ),
  };
}

function applyEnvironment(
  doc: Record<string, string>,
  extracted: { choices?: EnvironmentChoiceExtracted[] }
): Record<string, string> {
  const choices = extracted.choices ?? [];
  const lines = choices.length
    ? choices.map((c) => `- **${c.scenario}**: ${c.chosen}`)
    : ["- no environment preferences recorded yet"];
  return { ...doc, "thesis.md": upsertThesisSection(doc["thesis.md"] ?? "", "Environment preferences", lines) };
}

function applyTrajectory(doc: Record<string, string>, extracted: TrajectoryExtracted): Record<string, string> {
  const lines = [`- Three years out: ${extracted.direction}`];
  if (extracted.note) lines.push(`- ${extracted.note}`);
  return { ...doc, "thesis.md": upsertThesisSection(doc["thesis.md"] ?? "", "Trajectory", lines) };
}

/**
 * Pure updater: applies one module's extracted data to an existing (or
 * empty-skeleton) doc, returning a new doc. `range`/`evidence`/`voice`/
 * `metrics`/`mirror` have no extractor yet this wave (see moduleRegistry's
 * `noExtractorYet` receipts) — applying them is a no-op until their writers
 * exist.
 */
export function applyModuleToDoc(
  doc: Record<string, string>,
  key: ModuleKey,
  extracted: Record<string, unknown>
): Record<string, string> {
  switch (key) {
    case "anchor":
      return applyAnchor(doc, extracted as AnchorExtracted);
    case "dealbreakers":
      return applyDealbreakers(doc, extracted as unknown as DealbreakersExtracted);
    case "values":
      return applyValues(doc, extracted as { choices?: ValueChoiceExtracted[] });
    case "reactions":
      return applyReactions(doc, extracted as { reactions?: ReactionExtracted[] });
    case "energy":
      return applyEnergy(doc, extracted as EnergyExtracted);
    case "environment":
      return applyEnvironment(doc, extracted as { choices?: EnvironmentChoiceExtracted[] });
    case "trajectory":
      return applyTrajectory(doc, extracted as unknown as TrajectoryExtracted);
    default:
      return doc;
  }
}

function emptyDoc(): Record<string, string> {
  const doc: Record<string, string> = {};
  for (const filename of DOC_FILENAMES) doc[filename] = "";
  return doc;
}

function setProfileEmail(profileYaml: string, email: string): string {
  const profile = parseYamlObject(profileYaml);
  const identity = isPlainObject(profile.identity) ? profile.identity : { name: "", email: "" };
  const nextProfile = { ...profile, identity: { ...identity, email } };
  return PROFILE_HEADER + dumpYaml(nextProfile);
}

/**
 * Assembles the first `profiles.doc` from phase 1 alone (anchor +
 * reactions + values + dealbreakers) — the doc `checkpoint.ts` upserts the
 * moment `phaseOneComplete` flips true. Passes the validator's REQUIRED
 * checks (profile.yml identity + application_defaults, present) via the
 * exact same per-module builders `applyModuleToDoc` uses for every later
 * module — there is no separate "minimal doc" rendering logic to drift out
 * of sync with the incremental one.
 */
export function buildMinimalDoc(extracted: MinimalDocInput, authEmail: string): Record<string, string> {
  let doc = emptyDoc();
  doc = applyModuleToDoc(doc, "anchor", (extracted.anchor ?? {}) as unknown as Record<string, unknown>);
  doc = applyModuleToDoc(
    doc,
    "dealbreakers",
    (extracted.dealbreakers ?? { hard_disqualifiers: [], soft_concerns: [] }) as unknown as Record<string, unknown>
  );
  doc = applyModuleToDoc(doc, "values", { choices: extracted.values ?? [] });
  doc = applyModuleToDoc(doc, "reactions", { reactions: extracted.reactions ?? [] });
  doc["profile.yml"] = setProfileEmail(doc["profile.yml"], authEmail);
  return doc;
}
