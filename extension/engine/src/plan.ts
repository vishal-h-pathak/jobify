// plan.ts — port of `prepare_dom/_common.py::build_field_map` + the join
// logic that used to live inline in each per-ATS adapter
// (`field_maps.py::apply_field_map`'s value-resolution half). Pure: no DOM
// access, no chrome.* APIs — everything it needs is already captured on the
// Survey.

import { MAPS, selectorsFor, type FieldSpec, type FieldType } from "./maps.js";
import type { AtsMapKind, FillInstruction, Survey, SurveyField, SubmitPacket } from "./types.js";

type ResolvedValue = { value: string; source: string };

// Label -> SubmitPacket.identity key. `null` entries (Current Company/
// Company/Current Title/Title/Source) have no packet source — the packet
// carries contact identity only, not employment history or "how did you
// hear about us" — so they always resolve to "" and are silently skipped,
// exactly like `build_field_map` reading a form_answers key that was never
// populated.
const LABEL_TO_IDENTITY_KEY: Record<string, keyof SubmitPacket["identity"] | null> = {
  "First Name": "first_name",
  "Last Name": "last_name",
  "Full Name": "full_name",
  Name: "full_name",
  Email: "email",
  Phone: "phone",
  "LinkedIn URL": "linkedin_url",
  LinkedIn: "linkedin_url",
  "GitHub URL": "github_url",
  GitHub: "github_url",
  Portfolio: "portfolio_url",
  Website: "portfolio_url",
  Location: "location",
  "Current Location": "location",
  City: "location",
  "Current Company": null,
  Company: null,
  "Current Title": null,
  Title: null,
  Source: null,
};

function buildValueMap(packet: SubmitPacket): Record<string, ResolvedValue> {
  const map: Record<string, ResolvedValue> = {};
  for (const [label, identityKey] of Object.entries(LABEL_TO_IDENTITY_KEY)) {
    map[label] = identityKey
      ? { value: packet.identity[identityKey] || "", source: `identity.${identityKey}` }
      : { value: "", source: "" };
  }
  // __resume__ / __cover_letter__ become file/text instructions. The resume
  // "value" is the signed material URL (there's no meaningful fill string
  // for a file — the actual bytes travel via `EngineFiles.resume` at
  // execute time, joined through `source`); the cover letter is a real
  // paste value for the textarea driver.
  map.__resume__ = {
    value: packet.materials.resume_pdf_url || "",
    source: "materials.resume_pdf",
  };
  map.__cover_letter__ = {
    value: packet.materials.cover_letter_text || "",
    source: "materials.cover_letter_text",
  };
  return map;
}

/** Lever full-name override (port of `lever.py:92-99`): Lever wants the
 * full name in one field; the map points First Name at `name="name"` too,
 * so overriding Name/Full Name's resolved values after First Name gives
 * the same net "full name wins" result the Python adapter's
 * `value_overrides` produced. */
function applyLeverOverride(values: Record<string, ResolvedValue>, packet: SubmitPacket): void {
  const fullName =
    packet.identity.full_name || `${packet.identity.first_name} ${packet.identity.last_name}`.trim();
  values.Name = { value: fullName, source: "identity.full_name" };
  values["Full Name"] = { value: fullName, source: "identity.full_name" };
}

function kindMatchesType(kind: SurveyField["kind"], type: FieldType): boolean {
  if (type === "file") return kind === "file";
  if (type === "textarea") return kind === "textarea";
  if (type === "select") return kind === "select" || kind === "combobox";
  return true; // "text": Python's fill_text never constrained kind either
}

/**
 * Virtual selector matcher: does `field` satisfy `selector`, using only what
 * a SurveyField captures (name, automationId, kind, label)? This is NOT a
 * CSS engine — planFills gets a Survey, not a `Document`, so selectors are
 * interpreted as match rules against the survey's own shape rather than
 * executed against live DOM.
 *
 * Handled: `[data-automation-id="X"]` (Workday), `input[name="X"]` /
 * `textarea[name="X"]` (exact), `input[name*="X" i]` (fuzzy), and the bare
 * tag fallbacks (`textarea`, `input[type="file"]`,
 * `div[contenteditable="true"]`) used as chains' last resort.
 *
 * Deliberately a no-op for `[id=]`, `[aria-label=]`, `[placeholder*=]`,
 * `[type=]`, `[accept*=]`, and `label:has-text(...)` — the survey
 * abstraction folds id/aria-label/placeholder into `field.label` via the
 * label ladder (§3.1) and doesn't preserve raw HTML `type`/`accept`. Every
 * one of those selector shapes is what `label_selectors()` produced in the
 * Python ancestor anyway, i.e. exactly the label-match fallback
 * `findMatchingField` runs unconditionally after the chain — so returning
 * false here costs nothing: the next selector in the chain, or the label
 * fallback, reaches the same field.
 */
function matchesSelector(field: SurveyField, selector: string): boolean {
  const automationId = /^\[data-automation-id="([^"]+)"\]$/.exec(selector);
  if (automationId) return field.automationId === automationId[1];

  const nameFuzzy = /name\*="([^"]+)"\s*i?\]/.exec(selector);
  if (nameFuzzy) return field.name.toLowerCase().includes(nameFuzzy[1]!.toLowerCase());

  const nameExact = /name="([^"]+)"\]/.exec(selector);
  if (nameExact) return field.name === nameExact[1];

  if (selector === "textarea") return field.kind === "textarea";
  if (selector === 'input[type="file"]') return field.kind === "file";
  if (selector === 'div[contenteditable="true"]') return field.kind === "textarea";

  return false;
}

function findMatchingField(s: Survey, spec: FieldSpec, label: string): SurveyField | undefined {
  const type = spec.type ?? "text";
  const candidates = s.fields.filter((f) => kindMatchesType(f.kind, type));

  const chain = selectorsFor(spec, label);
  for (const selector of chain) {
    const match = candidates.find((f) => matchesSelector(f, selector));
    if (match) return match;
  }

  const norm = label.trim().toLowerCase();
  return candidates.find((f) => f.label.trim().toLowerCase() === norm);
}

// Side channel for FillReport.requiredEmpty (§ design note in the plan doc):
// FillInstruction carries no `required` flag and executeFills gets no
// `ats`/map parameter, so the map-level required-and-empty-or-unmatched
// labels planFills computes here can't travel through the pinned
// FillInstruction[] return type directly. Keyed by the exact array
// instance planFills returns; fill.ts reads it back for that same array,
// falling back to `[]` for a hand-built plan that didn't come from here.
const requiredEmptyByPlan = new WeakMap<FillInstruction[], string[]>();

export function requiredEmptyForPlan(plan: FillInstruction[]): string[] {
  return requiredEmptyByPlan.get(plan) ?? [];
}

export function planFills(s: Survey, packet: SubmitPacket, ats: AtsMapKind | "generic"): FillInstruction[] {
  const instructions: FillInstruction[] = [];
  if (ats === "generic") {
    requiredEmptyByPlan.set(instructions, []);
    return instructions;
  }

  const specs: FieldSpec[] = MAPS[ats];
  const values = buildValueMap(packet);
  if (ats === "lever") applyLeverOverride(values, packet);

  const requiredEmpty: string[] = [];

  for (const spec of specs) {
    const label = spec.label ?? spec.key;
    const required = Boolean(spec.required);
    const resolved = values[spec.key] ?? { value: "", source: "" };

    if (!resolved.value) {
      if (required) requiredEmpty.push(label);
      continue;
    }

    const field = findMatchingField(s, spec, label);
    if (!field) {
      if (required) requiredEmpty.push(label);
      continue;
    }

    instructions.push({ fieldId: field.id, value: resolved.value, source: resolved.source });
  }

  requiredEmptyByPlan.set(instructions, requiredEmpty);
  return instructions;
}
