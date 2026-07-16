import { MODULE_REGISTRY, type ModuleKey, type ModulesState } from "../onboarding/moduleRegistry";
import type {
  AnchorExtracted,
  DealbreakersExtracted,
  EnergyExtracted,
  EnvironmentChoiceExtracted,
  ReactionExtracted,
  TrajectoryExtracted,
  ValueChoiceExtracted,
} from "../onboarding/incrementalDoc";

/**
 * Pure mapper: (profiles.doc, profiles.validation_status, onboarding_sessions.{modules,
 * extracted}) -> the `/profile` view model. No I/O, no migration — everything the dossier
 * shows is derived from the two already-existing substrates (structured truth in `extracted`,
 * prose in `doc`), per V3A_DESIGN.md §3.
 */

export interface DerivedDossierInput {
  doc: Record<string, string>;
  validationStatus: { status: string; errors: string[] } | null;
  modules: ModulesState;
  extracted: Record<string, unknown>;
}

export interface SourceRef {
  moduleKey: ModuleKey;
  completedAt: string;
  label: string;
  href: string;
}

export interface DossierHeader {
  name: string;
  anchorLine: string | null;
  statusLine: string;
}

export interface MirrorNarrative {
  ready: boolean;
  paragraphs: string[];
  placeholder: string;
  source: SourceRef | null;
}

export interface FactsBand {
  anchor: { title: string | null; company: string | null; freeText: string | null; source: SourceRef | null };
  evidence: { provided: boolean; excerpt: string | null; source: SourceRef | null };
  skills: string[];
  metrics: { confirmed: string[]; heldBackCount: number; source: SourceRef | null };
  logistics: {
    base: string | null;
    remoteAcceptable: boolean | null;
    relocation: string | null;
    currentCompUsd: number | null;
    targetCompUsd: string | null;
  };
}

export interface WantsBand {
  values: Array<{ prompt: string; chosen: string; other: string | null }>;
  valuesSource: SourceRef | null;
  trajectory: { direction: string | null; note: string | null; source: SourceRef | null };
  environment: Array<{ scenario: string; chosen: string }>;
  environmentSource: SourceRef | null;
  dealbreakers: { hard: string[]; soft: string[]; degreeGate: string | null; source: SourceRef | null };
  tiers: Array<{ key: string; label: string; notes: string | null; referenceRole: string | null }>;
}

export interface TextureBand {
  energy: { hoursDisappear: string | null; keptPuttingOff: string | null; source: SourceRef | null };
  voice: { register: string | null; signaturePhrases: string[]; source: SourceRef | null };
  reactionTaste: {
    interestedCount: number;
    passedCount: number;
    notes: string[];
    source: SourceRef | null;
  };
}

export interface CompletenessState {
  doneCount: number;
  totalCount: number;
  missingModules: ModuleKey[];
  lastLearnedAt: string | null;
}

export interface ValidationIssue {
  section: string;
  message: string;
  fixHref: string;
}

export interface ValidationSurface {
  hasIssues: boolean;
  bannerText: string | null;
  issues: ValidationIssue[];
}

export interface ChangeLogEvent {
  label: string;
  moduleKey: ModuleKey;
  completedAt: string;
}

export interface DossierViewModel {
  header: DossierHeader;
  mirror: MirrorNarrative;
  facts: FactsBand;
  wants: WantsBand;
  texture: TextureBand;
  completeness: CompletenessState;
  validation: ValidationSurface;
  events: ChangeLogEvent[];
}

const MODULE_ORDER: readonly ModuleKey[] = Object.keys(MODULE_REGISTRY) as ModuleKey[];
const MIRROR_PLACEHOLDER = "Your story is still being written.";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function moduleLabel(key: ModuleKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function sourceFor(modules: ModulesState, key: ModuleKey): SourceRef | null {
  const completion = modules[key];
  if (!completion) return null;
  return {
    moduleKey: key,
    completedAt: completion.completed_at,
    label: `${moduleLabel(key)} · ${formatMonthDay(completion.completed_at)}`,
    href: `/onboarding?module=${key}`,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ── header ──────────────────────────────────────────────────────────────

function deriveHeader(
  extracted: Record<string, unknown>,
  modules: ModulesState,
  doneCount: number,
  lastLearnedAt: string | null
): DossierHeader {
  const identity = asRecord(extracted.identity);
  const anchor = asRecord(extracted.anchor) as AnchorExtracted;
  const name = asString(identity.name) ?? asString(anchor.current_title) ?? asString(anchor.free_text) ?? "Your profile";

  const title = anchor.current_title?.trim();
  const company = anchor.current_company?.trim();
  const years = anchor.years_in_role?.trim();
  let anchorLine: string | null = null;
  if (title && company && years) anchorLine = `${title} · ${company} · ${years} yrs`;
  else if (title && company) anchorLine = `${title} · ${company}`;
  else if (title) anchorLine = title;
  else if (anchor.free_text?.trim()) anchorLine = anchor.free_text.trim();

  const learnedPart = lastLearnedAt ? `last learned ${formatMonthDay(lastLearnedAt)}` : "last learned —";
  const statusLine = `${doneCount} of ${MODULE_ORDER.length} modules · ${learnedPart}`;

  return { name, anchorLine, statusLine };
}

// ── mirror ──────────────────────────────────────────────────────────────

function parseThesisIntro(thesisMd: string): string[] {
  const lines = thesisMd.split("\n");
  const introLines: string[] = [];
  for (const line of lines) {
    if (/^#\s+/.test(line)) continue; // top-level title
    if (/^##\s+/.test(line)) break; // first section — intro is done
    introLines.push(line);
  }
  const intro = introLines.join("\n").trim();
  if (!intro) return [];
  return intro
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function deriveMirror(doc: Record<string, string>, modules: ModulesState): MirrorNarrative {
  const ready = Boolean(modules.mirror);
  const paragraphs = ready ? parseThesisIntro(doc["thesis.md"] ?? "") : [];
  return {
    ready,
    paragraphs,
    placeholder: MIRROR_PLACEHOLDER,
    source: sourceFor(modules, "mirror"),
  };
}

// ── facts ───────────────────────────────────────────────────────────────

const CV_STUB_MARKER = "pending evidence module";

function parseMarkdownList(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

function extractMarkdownSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const startIdx = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (startIdx === -1) return "";
  const rest = lines.slice(startIdx + 1);
  const endIdx = rest.findIndex((l) => /^##\s+/.test(l));
  return (endIdx === -1 ? rest : rest.slice(0, endIdx)).join("\n");
}

function deriveFacts(
  doc: Record<string, string>,
  extracted: Record<string, unknown>,
  modules: ModulesState
): FactsBand {
  const anchor = asRecord(extracted.anchor) as AnchorExtracted;
  const cvMd = doc["cv.md"] ?? "";
  const evidenceProvided = Boolean(modules.evidence) && !cvMd.includes(CV_STUB_MARKER);

  const digest = doc["article-digest.md"] ?? "";
  const confirmed = modules.metrics ? parseMarkdownList(extractMarkdownSection(digest, "Confirmed metrics")) : [];
  const heldBackCount = modules.metrics ? parseMarkdownList(extractMarkdownSection(digest, "Never use")).length : 0;

  const skills = parseMarkdownList(extractMarkdownSection(cvMd, "Skills"));

  const identity = asRecord(extracted.identity);
  const locationAndComp = asRecord(identity.location_and_compensation);

  return {
    anchor: {
      title: asString(anchor.current_title),
      company: asString(anchor.current_company),
      freeText: asString(anchor.free_text),
      source: sourceFor(modules, "anchor"),
    },
    evidence: {
      provided: evidenceProvided,
      excerpt: evidenceProvided ? cvMd.trim() : null,
      source: modules.evidence ? sourceFor(modules, "evidence") : null,
    },
    skills,
    metrics: {
      confirmed,
      heldBackCount,
      source: sourceFor(modules, "metrics"),
    },
    logistics: {
      base: asString(locationAndComp.base),
      remoteAcceptable: typeof locationAndComp.remote_acceptable === "boolean" ? locationAndComp.remote_acceptable : null,
      relocation: asString(locationAndComp.relocation),
      currentCompUsd: typeof locationAndComp.current_comp_usd === "number" ? locationAndComp.current_comp_usd : null,
      targetCompUsd: asString(locationAndComp.target_comp_usd),
    },
  };
}

// ── wants ───────────────────────────────────────────────────────────────

function deriveWants(extracted: Record<string, unknown>, modules: ModulesState): WantsBand {
  const values = (asArray(extracted.values) as ValueChoiceExtracted[]).map((c) => ({
    prompt: c.prompt,
    chosen: c.chosen,
    other: c.other ?? null,
  }));
  const environment = (asArray(extracted.environment) as EnvironmentChoiceExtracted[]).map((c) => ({
    scenario: c.scenario,
    chosen: c.chosen,
  }));
  const trajectory = asRecord(extracted.trajectory) as Partial<TrajectoryExtracted>;
  const dealbreakers = asRecord(extracted.dealbreakers) as Partial<DealbreakersExtracted>;
  const targeting = asRecord(extracted.targeting);
  const tiers = (asArray(targeting.tiers) as Array<Record<string, unknown>>).map((tier) => ({
    key: String(tier.key ?? ""),
    label: String(tier.label ?? ""),
    notes: asString(tier.notes),
    referenceRole: asString(tier.reference_role),
  }));

  return {
    values,
    valuesSource: sourceFor(modules, "values"),
    trajectory: {
      direction: asString(trajectory.direction ?? null),
      note: asString(trajectory.note),
      source: sourceFor(modules, "trajectory"),
    },
    environment,
    environmentSource: sourceFor(modules, "environment"),
    dealbreakers: {
      hard: (dealbreakers.hard_disqualifiers ?? []) as string[],
      soft: (dealbreakers.soft_concerns ?? []) as string[],
      degreeGate: asString(dealbreakers.degree_gate),
      source: sourceFor(modules, "dealbreakers"),
    },
    tiers,
  };
}

// ── texture ─────────────────────────────────────────────────────────────

function deriveTexture(extracted: Record<string, unknown>, modules: ModulesState): TextureBand {
  const energy = asRecord(extracted.energy) as EnergyExtracted;
  const voice = modules.voice ? asRecord(extracted.voice) : {};
  const reactions = asArray(extracted.reactions) as ReactionExtracted[];
  const interestedCount = reactions.filter((r) => r.reaction === "interested").length;
  const passedCount = reactions.filter((r) => r.reaction === "not_interested").length;
  const notes = reactions.map((r) => r.note).filter((n): n is string => Boolean(n && n.trim()));

  return {
    energy: {
      hoursDisappear: asString(energy.hours_disappear),
      keptPuttingOff: asString(energy.kept_putting_off),
      source: sourceFor(modules, "energy"),
    },
    voice: {
      register: asString(voice.register),
      signaturePhrases: (asArray(voice.signature_phrases) as string[]) ?? [],
      source: modules.voice ? sourceFor(modules, "voice") : null,
    },
    reactionTaste: {
      interestedCount,
      passedCount,
      notes,
      source: sourceFor(modules, "reactions"),
    },
  };
}

// ── completeness ────────────────────────────────────────────────────────

function deriveCompleteness(modules: ModulesState): CompletenessState {
  const missingModules = MODULE_ORDER.filter((key) => !modules[key]);
  const doneCount = MODULE_ORDER.length - missingModules.length;
  const completedAts = MODULE_ORDER.map((key) => modules[key]?.completed_at).filter((v): v is string => Boolean(v));
  const lastLearnedAt = completedAts.length
    ? completedAts.reduce((latest, cur) => (cur > latest ? cur : latest))
    : null;
  return { doneCount, totalCount: MODULE_ORDER.length, missingModules, lastLearnedAt };
}

// ── validation ──────────────────────────────────────────────────────────

const VALIDATION_FILE_INFO: Record<string, { message: string; moduleKey: ModuleKey }> = {
  "profile.yml": { message: "Your basic info needs attention.", moduleKey: "anchor" },
  "disqualifiers.yml": { message: "Your dealbreakers need attention.", moduleKey: "dealbreakers" },
  "portals.yml": { message: "Your target boards need attention.", moduleKey: "values" },
};

function deriveValidation(validationStatus: { status: string; errors: string[] } | null): ValidationSurface {
  if (!validationStatus || validationStatus.status !== "invalid" || validationStatus.errors.length === 0) {
    return { hasIssues: false, bannerText: null, issues: [] };
  }

  const offendingFiles = new Set<string>();
  for (const error of validationStatus.errors) {
    const file = error.split(":")[0]?.trim();
    if (file) offendingFiles.add(file);
  }

  const issues: ValidationIssue[] = [...offendingFiles].map((file) => {
    const info = VALIDATION_FILE_INFO[file] ?? { message: "This section needs attention.", moduleKey: "anchor" as ModuleKey };
    return { section: file, message: info.message, fixHref: `/onboarding?module=${info.moduleKey}` };
  });

  return {
    hasIssues: true,
    bannerText: `${issues.length} section${issues.length === 1 ? "" : "s"} need attention`,
    issues,
  };
}

// ── change log ──────────────────────────────────────────────────────────

function deriveEvents(modules: ModulesState): ChangeLogEvent[] {
  return MODULE_ORDER.filter((key) => modules[key])
    .map((key) => {
      const completion = modules[key]!;
      return {
        label: `${formatMonthDay(completion.completed_at)} — ${moduleLabel(key)} · ${completion.receipt}`,
        moduleKey: key,
        completedAt: completion.completed_at,
      };
    })
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}

// ── top-level ───────────────────────────────────────────────────────────

export function deriveDossier(input: DerivedDossierInput): DossierViewModel {
  const { doc, validationStatus, modules, extracted } = input;

  const completeness = deriveCompleteness(modules);

  return {
    header: deriveHeader(extracted, modules, completeness.doneCount, completeness.lastLearnedAt),
    mirror: deriveMirror(doc, modules),
    facts: deriveFacts(doc, extracted, modules),
    wants: deriveWants(extracted, modules),
    texture: deriveTexture(extracted, modules),
    completeness,
    validation: deriveValidation(validationStatus),
    events: deriveEvents(modules),
  };
}
