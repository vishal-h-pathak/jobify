// constitution.test.ts — the four CI gates from the pinned build step 6:
//   (a) package root exports exactly the pinned API — nothing else;
//   (b) grep-test: no `chrome.` / `browser.` reference anywhere in src;
//   (c) deny-test: walk every bundled map, fail on a deny-lexicon match;
//   (d) drivers never receive a SurveyButton (compile-time, via `tsc`).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as engine from "../src/index.js";
import { runDriver } from "../src/drivers.js";
import { MAPS } from "../src/maps.js";
import type { EngineFiles, FillInstruction, SurveyButton } from "../src/types.js";

describe("constitution (a): package root exports exactly the pinned API", () => {
  it("exports exactly survey, planFills, executeFills — nothing else", () => {
    // `export type { ... }` erases at compile time, so only the three
    // functions show up as runtime own-properties of the module.
    expect(Object.keys(engine).sort()).toEqual(["executeFills", "planFills", "survey"]);
  });
});

describe("constitution (b): zero chrome.*/browser.* references in src/", () => {
  function allTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...allTsFiles(full));
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  it("never references chrome. or browser. anywhere under src/", () => {
    const srcDir = join(import.meta.dirname, "..", "src");
    const offenders: string[] = [];
    for (const file of allTsFiles(srcDir)) {
      const text = readFileSync(file, "utf-8");
      if (/\bchrome\./.test(text) || /\bbrowser\./.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("constitution (c): deny-lexicon walk over every bundled map", () => {
  const DENY = /submit|apply now|send application|finish/i;

  it("no fill target's selector or label matches the final-action deny lexicon", () => {
    const offenders: string[] = [];
    for (const [ats, specs] of Object.entries(MAPS)) {
      for (const spec of specs) {
        const label = spec.label ?? spec.key;
        if (DENY.test(label)) offenders.push(`${ats}: label "${label}"`);
        for (const selector of spec.selectors ?? []) {
          if (DENY.test(selector)) offenders.push(`${ats}: selector "${selector}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("constitution (d): drivers never accept a SurveyButton", () => {
  it("is enforced at compile time — tsc --noEmit fails if the line below ever stops being a type error", () => {
    const button: SurveyButton = { id: "b1", label: "Submit Application", kind: "submit" };
    const instr: FillInstruction = { fieldId: "b1", value: "x", source: "identity.email" };
    const files: EngineFiles = {};

    // @ts-expect-error — runDriver's field parameter is SurveyField, not SurveyButton.
    void runDriver(document, button, instr, files, "native");

    expect(true).toBe(true);
  });
});
