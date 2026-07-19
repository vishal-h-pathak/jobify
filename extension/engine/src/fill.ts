// fill.ts — executeFills: dispatch each planned instruction to its driver,
// re-read the field, retry on mismatch, and report the honest truth. Never
// throws past an instruction — the report IS the truth (§3.3).

import { findFieldElements } from "./dom.js";
import { isTruthyCheckboxValue, runDriver, type Strategy } from "./drivers.js";
import { requiredEmptyForPlan } from "./plan.js";
import { settle } from "./settle.js";
import { readValue } from "./survey.js";
import type { EngineFiles, FillInstruction, FillOutcome, FillReport, Survey, SurveyField } from "./types.js";

const TEXT_LIKE_KINDS = new Set<SurveyField["kind"]>(["text", "textarea", "date"]);

// Tuned smaller than a "real" page might warrant purely to keep this
// package's own test suite fast; the shape (bounded quiescence, never a
// global load-state wait) is what F1 actually calls for — the exact
// numbers are a judgment call a later session can retune from telemetry.
const READBACK_SETTLE = { quietMs: 10, maxWaitMs: 200 };

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Re-read a field's live value the same way read-back needs it — file and
 * radio_group don't reduce to a plain string compare the way survey.ts's
 * `readValue` does, so they get their own rule here. */
function readBackMatches(root: Document, field: SurveyField, instr: FillInstruction): boolean {
  const els = findFieldElements(root, field);
  if (!els.length) return false;

  if (field.kind === "file") {
    const el = els[0] as HTMLInputElement;
    // instr.value is the signed material URL, not a filename — a file
    // input never reports that back, so "did it stick" just means "is a
    // file attached", not "does the value string match".
    return Boolean(el.files && el.files.length > 0);
  }

  if (field.kind === "radio_group") {
    const checked = (els as HTMLInputElement[]).find((r) => r.checked);
    if (!checked) return false;
    const label = checked.closest("label")?.textContent?.trim() || checked.value || "";
    return normalize(label) === normalize(instr.value);
  }

  if (field.kind === "checkbox") {
    const el = els[0] as HTMLInputElement;
    return el.checked === isTruthyCheckboxValue(instr.value);
  }

  return normalize(readValue(els[0]!, field.kind)) === normalize(instr.value);
}

export async function executeFills(
  root: Document,
  s: Survey,
  plan: FillInstruction[],
  files: EngineFiles,
): Promise<FillReport> {
  const outcomes: FillOutcome[] = [];

  for (const instr of plan) {
    const field = s.fields.find((f) => f.id === instr.fieldId);
    if (!field) {
      outcomes.push({
        fieldId: instr.fieldId,
        label: instr.fieldId,
        layer: "map",
        attempted: false,
        filled: false,
        stuckAfterReadback: false,
        strategy: "",
      });
      continue;
    }

    let strategy: Strategy = "native";
    let attempted = await runDriver(root, field, instr, files, strategy);

    await settle(root, READBACK_SETTLE);
    let filled = attempted && readBackMatches(root, field, instr);

    if (attempted && !filled && TEXT_LIKE_KINDS.has(field.kind)) {
      strategy = "keystrokes";
      await runDriver(root, field, instr, files, strategy);
      await settle(root, READBACK_SETTLE);
      filled = readBackMatches(root, field, instr);
    }

    outcomes.push({
      fieldId: field.id,
      label: field.label,
      layer: "map",
      attempted,
      filled,
      stuckAfterReadback: attempted && !filled,
      strategy,
    });
  }

  return { outcomes, requiredEmpty: computeRequiredEmpty(root, s, plan) };
}

/** Union of planFills' map-level required-empty labels (parity with
 * Python's `apply_field_map`, via the WeakMap side channel — see plan.ts)
 * and any DOM-`required` field still empty after every fill attempt. The
 * second half is a defensive net for a hand-built plan array that didn't
 * come from planFills, and for DOM-required fields the map didn't even
 * attempt. */
function computeRequiredEmpty(root: Document, s: Survey, plan: FillInstruction[]): string[] {
  const labels = new Set(requiredEmptyForPlan(plan));

  for (const field of s.fields) {
    if (!field.required) continue;
    if (readLiveOrGroupValue(root, field)) continue;
    labels.add(field.label);
  }

  return Array.from(labels);
}

function readLiveOrGroupValue(root: Document, field: SurveyField): string {
  const els = findFieldElements(root, field);
  if (!els.length) return "";
  if (field.kind === "radio_group") {
    const checked = (els as HTMLInputElement[]).find((r) => r.checked);
    return checked ? checked.value || "checked" : "";
  }
  if (field.kind === "file") {
    const el = els[0] as HTMLInputElement;
    return el.files && el.files.length > 0 ? el.files[0]!.name : "";
  }
  return readValue(els[0]!, field.kind);
}
