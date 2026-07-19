import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("dossier print stylesheet", () => {
  it("globals.css defines print rules scoped to the dossier's printable region (D5 — Print/PDF affordance)", () => {
    const css = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf-8");
    expect(css).toContain("@media print");
    expect(css).toContain(".dossier-print");
  });
});
