// survey.ts — TS port + upgrade of `browser_tools.py::get_form_fields`
// (§3.1). Enumerates fields + buttons across the document, every open
// shadow root (recursive), and every same-origin iframe (frame-path ids),
// emitting one normalized Survey. Zero extension-API access, zero network.

import {
  FIELD_ID_ATTR,
  escapeCss,
  findAccessibleIframes,
  findShadowRoots,
  isConsideredVisible,
} from "./dom.js";
import type { Survey, SurveyButton, SurveyField } from "./types.js";

const COMBOBOX_SELECTOR =
  '[role="combobox"], [role="listbox"], [data-react-select-container], .select__control, .select2-container';
const FIELD_SELECTOR = `input, textarea, select, [contenteditable="true"], ${COMBOBOX_SELECTOR}`;
const BUTTON_SELECTOR = 'button, [role="button"], a[role="button"], input[type="submit"], input[type="button"]';
const NON_FIELD_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

type Counter = { field: number; button: number };

export function survey(root: Document): Survey {
  const counter: Counter = { field: 0, button: 0 };
  const fields: SurveyField[] = [];
  const buttons: SurveyButton[] = [];

  collectFromDocument(root, "", counter, fields, buttons);

  return { url: root.URL || "", fields, buttons };
}

function collectFromDocument(
  doc: Document,
  framePath: string,
  counter: Counter,
  fields: SurveyField[],
  buttons: SurveyButton[],
): void {
  // Every scanning root within this document/frame: the document itself,
  // plus every open shadow root reachable from it (light DOM traversal —
  // shadow-DOM encapsulation means a root's querySelectorAll never reaches
  // into a descendant shadow root on its own, so each root is scanned once
  // and results never double up).
  const scanRoots: (Document | ShadowRoot)[] = [doc, ...findShadowRoots(doc)];
  for (const scanRoot of scanRoots) {
    collectFieldsIn(scanRoot, framePath, counter, fields);
    collectButtonsIn(scanRoot, counter, buttons);
  }

  for (const [index, iframe] of findAccessibleIframes(doc).entries()) {
    const childDoc = iframe.contentDocument;
    if (!childDoc) continue;
    const childPath = framePath ? `${framePath}/iframe${index}` : `iframe${index}`;
    collectFromDocument(childDoc, childPath, counter, fields, buttons);
  }
}

function collectFieldsIn(
  scanRoot: Document | ShadowRoot,
  framePath: string,
  counter: Counter,
  fields: SurveyField[],
): void {
  const seen = new Set<Element>();
  const emittedRadioGroups = new Set<string>();

  for (const el of Array.from(scanRoot.querySelectorAll(FIELD_SELECTOR))) {
    if (seen.has(el)) continue;
    const tag = el.tagName;
    const type = tag === "INPUT" ? (el as HTMLInputElement).type || "text" : "";

    if (tag === "INPUT" && NON_FIELD_INPUT_TYPES.has(type)) continue;
    if (!isConsideredVisible(el)) continue;

    if (tag === "INPUT" && type === "radio") {
      const name = (el as HTMLInputElement).name;
      const groupKey = name || `__unnamed_radio_${counter.field}`;
      if (emittedRadioGroups.has(groupKey)) {
        seen.add(el);
        continue;
      }
      emittedRadioGroups.add(groupKey);
      // Group by name when there is one; a nameless radio can't be found
      // by any later selector query anyway, so it's a one-element group
      // built from what we already have in hand rather than a re-query
      // that would come back empty.
      const groupRadios = name
        ? Array.from(scanRoot.querySelectorAll(`input[type="radio"][name="${escapeCss(name)}"]`))
        : [el];
      fields.push(buildRadioGroupField(groupRadios, name, framePath, counter, seen));
      continue;
    }

    seen.add(el);
    // A combobox container may wrap its own text input for typing (Ashby/
    // React-select pattern), and react-select-style markup commonly nests
    // a second combobox-matching element inside the outer container (e.g.
    // an outer `[role="combobox"]` wrapping an inner `.select__control`
    // display div) — both are part of THIS one field, not a separate one,
    // so every combobox-matching descendant is claimed here too. Document
    // order guarantees the outer element is visited before its
    // descendants, so this always runs before the inner one would
    // otherwise be re-processed as its own field.
    if (matchesCombobox(el)) {
      const inner = el.querySelector("input, textarea");
      if (inner) seen.add(inner);
      for (const nested of Array.from(el.querySelectorAll(COMBOBOX_SELECTOR))) {
        seen.add(nested);
      }
    }

    fields.push(buildField(el, framePath, counter));
  }
}

function collectButtonsIn(
  scanRoot: Document | ShadowRoot,
  counter: Counter,
  buttons: SurveyButton[],
): void {
  const seen = new Set<Element>();
  for (const el of Array.from(scanRoot.querySelectorAll(BUTTON_SELECTOR))) {
    if (seen.has(el)) continue;
    if (!isConsideredVisible(el)) continue;
    seen.add(el);

    const id = `b${++counter.button}`;
    el.setAttribute(FIELD_ID_ATTR, id);
    buttons.push({
      id,
      label: buttonLabel(el),
      kind: buttonKind(el),
    });
  }
}

function buttonLabel(el: Element): string {
  const text = (el.textContent || el.getAttribute("aria-label") || (el as HTMLInputElement).value || "").trim();
  return text.slice(0, 120);
}

function buttonKind(el: Element): SurveyButton["kind"] {
  if (el.tagName === "A") return "link";
  const type = (el as HTMLInputElement | HTMLButtonElement).type;
  if (type === "submit") return "submit";
  return "button";
}

function buildField(el: Element, framePath: string, counter: Counter): SurveyField {
  const id = `f${++counter.field}`;
  el.setAttribute(FIELD_ID_ATTR, id);
  const kind = detectKind(el);
  const label = resolveLabel(el);

  const field: SurveyField = {
    id,
    kind,
    label,
    name: readName(el),
    autocomplete: el.getAttribute("autocomplete") || "",
    required: isRequired(el),
    value: readValue(el, kind),
    frame: framePath,
  };

  const options = readOptions(el, kind);
  if (options) field.options = options;

  const automationId = el.getAttribute("data-automation-id");
  if (automationId) field.automationId = automationId;

  return field;
}

function buildRadioGroupField(
  radios: Element[],
  name: string,
  framePath: string,
  counter: Counter,
  seen: Set<Element>,
): SurveyField {
  const id = `f${++counter.field}`;

  let checkedLabel = "";
  const options: string[] = [];
  let required = false;
  let autocomplete = "";
  let automationId: string | undefined;

  for (const radio of radios as HTMLInputElement[]) {
    seen.add(radio);
    radio.setAttribute(FIELD_ID_ATTR, id);
    const optionLabel = resolveLabel(radio);
    options.push(optionLabel);
    if (radio.checked) checkedLabel = optionLabel;
    if (isRequired(radio)) required = true;
    if (!autocomplete) autocomplete = radio.getAttribute("autocomplete") || "";
    if (!automationId) automationId = radio.getAttribute("data-automation-id") || undefined;
  }

  const field: SurveyField = {
    id,
    kind: "radio_group",
    label: options.length ? radioGroupLabel(radios) : name || "",
    name,
    autocomplete,
    required,
    value: checkedLabel,
    options,
    frame: framePath,
  };
  if (automationId) field.automationId = automationId;
  return field;
}

/** The radio group's own label: the nearest fieldset legend, or the first
 * radio's resolved label with its own per-option text stripped isn't
 * possible generically, so fall back to a fieldset legend or the group
 * `name` — matches the "fieldset legend" rung of the label ladder. */
function radioGroupLabel(radios: Element[]): string {
  const first = radios[0];
  const legend = first?.closest("fieldset")?.querySelector("legend")?.textContent?.trim();
  if (legend) return legend;
  return (first as HTMLInputElement)?.name || "";
}

function matchesCombobox(el: Element): boolean {
  return el.matches(COMBOBOX_SELECTOR);
}

function detectKind(el: Element): SurveyField["kind"] {
  const tag = el.tagName;
  if (tag === "SELECT") return "select";
  if (tag === "TEXTAREA") return "textarea";
  if (el.getAttribute("contenteditable") === "true") return "textarea";
  if (matchesCombobox(el)) return "combobox";

  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type || "text";
    if (type === "checkbox") return "checkbox";
    if (type === "file") return "file";
    if (type === "date") return "date";
    if (el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete")) {
      return "combobox";
    }
    return "text";
  }
  return "unknown";
}

function readName(el: Element): string {
  return (el as HTMLInputElement).name || el.getAttribute("data-name") || "";
}

function isRequired(el: Element): boolean {
  return (el as HTMLInputElement).required === true || el.getAttribute("aria-required") === "true";
}

/** Exported for fill.ts's read-back verification, which re-reads a live
 * element the same way survey() first read it — kept as one implementation
 * so the two never drift apart. */
export function readValue(el: Element, kind: SurveyField["kind"]): string {
  if (kind === "checkbox") return (el as HTMLInputElement).checked ? "true" : "";
  if (kind === "file") {
    const files = (el as HTMLInputElement).files;
    return files && files.length > 0 ? files[0]!.name : "";
  }
  if (kind === "textarea" && el.getAttribute("contenteditable") === "true") {
    return (el.textContent || "").trim();
  }
  if (kind === "combobox" && !("value" in el)) {
    return (el.textContent || "").trim().slice(0, 200);
  }
  return (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value || "";
}

function readOptions(el: Element, kind: SurveyField["kind"]): string[] | undefined {
  if (kind === "select") {
    return Array.from((el as HTMLSelectElement).options).map((o) => o.textContent?.trim() || "");
  }
  if (kind === "combobox") {
    const optionEls = el.querySelectorAll('[role="option"], li, option');
    const labels = Array.from(optionEls)
      .map((o) => o.textContent?.trim() || "")
      .filter(Boolean);
    return labels.length ? labels : undefined;
  }
  return undefined;
}

// ── Label resolution ladder (§3.1 pinned order — NOT the Python ancestor's
// order, which tried aria-label first): <label for> → wrapping label →
// aria-label / aria-labelledby → placeholder → nearest preceding text /
// fieldset legend. Falls back to name/id/tag if every rung misses, so a
// field never carries an empty label into downstream matching.
//
// Exported so drivers.ts's radio_group driver and fill.ts's read-back can
// resolve an individual radio's option label the exact same way survey()
// built `SurveyField.options` in the first place — matching against a
// narrower rule (e.g. wrapping-label-only) would silently diverge from
// what the Survey already promised the caller.
export function resolveLabel(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;

  const id = (el as HTMLElement).id;
  if (id) {
    const forLabel = root.querySelector(`label[for="${escapeCss(id)}"]`);
    const text = forLabel?.textContent?.trim();
    if (text) return text;
  }

  const wrapping = el.closest("label");
  const wrappingText = wrapping?.textContent?.trim();
  if (wrappingText) return wrappingText;

  const ariaLabel = el.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((refId) => root.querySelector(`#${escapeCss(refId)}`)?.textContent?.trim() || "")
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) return text;
  }

  const placeholder = (el as HTMLInputElement).placeholder?.trim();
  if (placeholder) return placeholder;

  let walker = el.previousElementSibling;
  let hops = 0;
  while (walker && hops < 5) {
    const text = (walker.textContent || "").trim();
    if (text.length > 2 && text.length < 200) return text;
    walker = walker.previousElementSibling;
    hops++;
  }

  const legend = el.closest("fieldset")?.querySelector("legend")?.textContent?.trim();
  if (legend) return legend;

  return readName(el) || (el as HTMLElement).id || el.tagName.toLowerCase();
}
