import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// V3C_DESIGN.md §0 / this session's own "Constitution (enforced here too)":
// no Anthropic/API key, no LLM call anywhere in the extension. This walks
// the whole `extension/` tree (this file's own path proves the walk reaches
// shell/) looking for the literal tokens; it must never find one outside
// this file's own pattern-list string below.
const EXTENSION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const PATTERN = /anthropic|ANTHROPIC|api_key/;
const SELF = fileURLToPath(import.meta.url);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

describe("constitution: no anthropic/ANTHROPIC/api_key anywhere in extension/", () => {
  it("finds zero matches outside this test file's own pattern definition", () => {
    const offenders: string[] = [];
    for (const file of walk(EXTENSION_ROOT)) {
      if (file === SELF) continue; // this file necessarily contains the literal tokens above
      let content: string;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue; // binary/unreadable — not a text-based leak vector
      }
      if (PATTERN.test(content)) offenders.push(path.relative(EXTENSION_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});
