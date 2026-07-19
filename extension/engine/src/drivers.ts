// drivers.ts — widget drivers keyed by SurveyField.kind (§3.2). One driver
// library, shared by every ladder layer. Detection by role/pattern already
// happened in survey.ts; these functions just know how to WRITE a value
// into whatever survey.ts classified. Every driver is typed to
// `field: SurveyField` (never `SurveyButton`) — constitution.test.ts checks
// this at compile time.

import { findFieldElements } from "./dom.js";
import { settle } from "./settle.js";
import type { EngineFiles, FillInstruction, SurveyField } from "./types.js";

// Strategy escalation interface (native -> keystrokes). The union stays
// open (`string & {}`) as a typed extension point for E2's debugger-
// protocol trusted-input strategy, added once read-back keeps failing
// native + keystrokes on a real form — not implemented here.
export type Strategy = "native" | "keystrokes" | (string & {});

const CHECKED_TRUE_VALUES = new Set(["true", "1", "yes", "on", "checked"]);

/** Shared with fill.ts's read-back so "does the checkbox match the
 * instruction" uses the exact same truthy-string rule the driver wrote. */
export function isTruthyCheckboxValue(value: string): boolean {
  return CHECKED_TRUE_VALUES.has(value.trim().toLowerCase());
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  // Plain `el.value = x` gets silently reverted by React's controlled-input
  // tracker (F3) — writing through the native property setter bypasses
  // React's own value-tracking shim, which only intercepts the instance
  // property, not the prototype's.
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function setByKeystrokes(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  // Clear the underlying slot directly (no events) before the per-char
  // loop — a real user doesn't fire a premature `change` mid-edit; only
  // the trailing `change` after the last keystroke reflects a commit.
  if (setter) setter.call(el, "");
  else el.value = "";
  for (const ch of value) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: ch, bubbles: true }));
    const next = el.value + ch;
    if (setter) setter.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** text / textarea / date / contenteditable — everything whose value is a
 * plain string write. */
async function fillTextLike(
  root: Document,
  field: SurveyField,
  value: string,
  strategy: Strategy,
): Promise<boolean> {
  const el = findFieldElements(root, field)[0];
  if (!el) return false;

  if (el.getAttribute("contenteditable") === "true") {
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  const input = el as HTMLInputElement | HTMLTextAreaElement;
  if (strategy === "keystrokes") await setByKeystrokes(input, value);
  else setNativeValue(input, value);
  return true;
}

function fillSelect(root: Document, field: SurveyField, value: string): boolean {
  const el = findFieldElements(root, field)[0] as HTMLSelectElement | undefined;
  if (!el) return false;
  const norm = value.trim().toLowerCase();
  const option = Array.from(el.options).find(
    (o) => o.value === value || (o.textContent ?? "").trim().toLowerCase() === norm,
  );
  if (!option) return false;
  el.value = option.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function fillCheckbox(root: Document, field: SurveyField, value: string): boolean {
  const el = findFieldElements(root, field)[0] as HTMLInputElement | undefined;
  if (!el) return false;
  const want = isTruthyCheckboxValue(value);
  if (el.checked !== want) el.click();
  return true;
}

/** Matches by option label (wrapping <label> text or the radio's own
 * `value` attribute) among every radio survey() tagged into this group. */
function fillRadioGroup(root: Document, field: SurveyField, value: string): boolean {
  const radios = findFieldElements(root, field) as HTMLInputElement[];
  if (!radios.length) return false;
  const norm = value.trim().toLowerCase();
  const match = radios.find((r) => {
    if (r.value.trim().toLowerCase() === norm) return true;
    const wrapping = r.closest("label")?.textContent?.trim().toLowerCase();
    return wrapping === norm;
  });
  if (!match) return false;
  match.click();
  return true;
}

/** ARIA-combobox / typeahead widgets: open -> set filter text -> await
 * options -> click the matching option. Widget-scoped clicks are FILLING
 * (opening the widget, choosing an option) and live only inside this
 * driver — the engine never clicks anything outside a widget it owns. */
async function fillCombobox(root: Document, field: SurveyField, value: string): Promise<boolean> {
  const container = findFieldElements(root, field)[0];
  if (!container) return false;

  container.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const innerInput = container.querySelector("input, textarea") as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (innerInput) setNativeValue(innerInput, value);

  // A real widget renders its option list asynchronously after the filter
  // text changes; give it a short quiet window (tuned smaller than the
  // fill.ts read-back settle — option lists render fast when they do).
  await settle(container, { quietMs: 50, maxWaitMs: 500 });

  const norm = value.trim().toLowerCase();
  const options = Array.from(container.querySelectorAll('[role="option"], li, option'));
  const match = options.find((o) => (o.textContent ?? "").trim().toLowerCase() === norm);
  if (!match) return false;

  match.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
}

function fileForSource(source: string, files: EngineFiles): File | undefined {
  if (source === "materials.resume_pdf") return files.resume;
  if (source === "materials.cover_letter_pdf") return files.cover_letter;
  return undefined;
}

function fillFile(root: Document, field: SurveyField, files: EngineFiles, source: string): boolean {
  const el = findFieldElements(root, field)[0] as HTMLInputElement | undefined;
  if (!el) return false;
  const file = fileForSource(source, files);
  if (!file) return false;

  const view = el.ownerDocument.defaultView ?? window;
  const dt = new view.DataTransfer();
  dt.items.add(file);
  el.files = dt.files;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** Dispatch by `field.kind`. Never accepts a `SurveyButton` — the parameter
 * type is `SurveyField`, checked at compile time (constitution.test.ts). */
export async function runDriver(
  root: Document,
  field: SurveyField,
  instruction: FillInstruction,
  files: EngineFiles,
  strategy: Strategy,
): Promise<boolean> {
  switch (field.kind) {
    case "text":
    case "date":
    case "textarea":
      return fillTextLike(root, field, instruction.value, strategy);
    case "select":
      return fillSelect(root, field, instruction.value);
    case "checkbox":
      return fillCheckbox(root, field, instruction.value);
    case "radio_group":
      return fillRadioGroup(root, field, instruction.value);
    case "combobox":
      return fillCombobox(root, field, instruction.value);
    case "file":
      return fillFile(root, field, files, instruction.source);
    case "unknown":
      return false;
  }
}
