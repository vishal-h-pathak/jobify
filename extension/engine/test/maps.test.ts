import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";
import { MAPS, selectorsFor, type FieldSpec } from "../src/maps.js";

// Table-driven parity test against the Python source of truth itself —
// not a second hand-copy of it — so a future YAML edit that isn't ported
// here fails this test instead of silently drifting.
const YAML_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "jobify",
  "submit",
  "adapters",
  "prepare_dom",
  "field_maps.yml",
);

type YamlAtsEntry = { defaults?: Record<string, unknown>; fields: Record<string, unknown>[] };
type YamlDoc = Record<string, YamlAtsEntry>;

function expectedFromYaml(ats: keyof YamlDoc): FieldSpec[] {
  const doc = loadYaml(readFileSync(YAML_PATH, "utf-8")) as YamlDoc;
  const entry = doc[ats]!;
  const defaults = entry.defaults ?? {};
  return entry.fields.map((spec) => {
    const merged: Record<string, unknown> = { ...defaults, ...spec };
    if (Array.isArray(merged.selectors)) {
      // Playwright's `:visible` pseudo is dropped on the TS side —
      // visibility is a runtime helper here, not a selector concern.
      merged.selectors = (merged.selectors as string[]).map((s) => s.replace(/:visible$/, ""));
    }
    return merged as FieldSpec;
  });
}

describe.each(["greenhouse", "lever", "ashby"] as const)("maps.ts parity — %s", (ats) => {
  it("matches field_maps.yml verbatim: keys, order, required flags, selector chains", () => {
    expect(MAPS[ats]).toEqual(expectedFromYaml(ats));
  });
});

describe("maps.ts — Workday (new for E1, no YAML ancestor)", () => {
  it("anchors every spec on a data-automation-id selector", () => {
    for (const spec of MAPS.workday) {
      expect(spec.selectors?.[0]).toMatch(/^\[data-automation-id="[^"]+"\]$/);
    }
  });

  it("marks the identity essentials required and Source/City-aliases optional", () => {
    const byKey = Object.fromEntries(MAPS.workday.map((s) => [s.key, s]));
    expect(byKey["First Name"]!.required).toBe(true);
    expect(byKey["Last Name"]!.required).toBe(true);
    expect(byKey["Email"]!.required).toBe(true);
    expect(byKey["Phone"]!.required).toBe(true);
    expect(byKey["__resume__"]!.required).toBe(true);
    expect(byKey["City"]!.required).toBeFalsy();
    expect(byKey["Source"]!.required).toBeFalsy();
  });

  it("aliases Location/Current Location/City onto the same addressSection_city anchor", () => {
    const byKey = Object.fromEntries(MAPS.workday.map((s) => [s.key, s]));
    const cityAnchor = '[data-automation-id="addressSection_city"]';
    expect(byKey["Location"]!.selectors).toEqual([cityAnchor]);
    expect(byKey["Current Location"]!.selectors).toEqual([cityAnchor]);
    expect(byKey["City"]!.selectors).toEqual([cityAnchor]);
  });
});

describe("selectorsFor", () => {
  it("leads with explicit selectors, then the name-attr pair", () => {
    const spec: FieldSpec = { key: "Email", name: "job_application[email]" };
    expect(selectorsFor(spec, "Email")).toEqual([
      'input[name="job_application[email]"]',
      'textarea[name="job_application[email]"]',
    ]);
  });

  it("appends the two fuzzy name selectors for flagged text fields, using the label", () => {
    const spec: FieldSpec = { key: "First Name", required: true, fuzzy_name_fallback: true };
    expect(selectorsFor(spec, "First Name")).toEqual([
      'input[name*="first_name"]',
      'input[name*="firstname"]',
    ]);
  });

  it("never appends fuzzy selectors for non-text types even when flagged", () => {
    const spec: FieldSpec = { key: "__resume__", type: "file", fuzzy_name_fallback: true, selectors: ['input[type="file"]'] };
    expect(selectorsFor(spec, "Resume")).toEqual(['input[type="file"]']);
  });
});
