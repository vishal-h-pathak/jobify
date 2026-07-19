import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Lives in this package (not a separate extension/-root package) purely so
// it rides the same `vitest run` the rest of this package's suite does —
// it audits `extension/manifest.json`, which is one directory up.
const MANIFEST_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../manifest.json");

function readManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("extension/manifest.json audit", () => {
  it("is manifest_version 3", () => {
    expect(readManifest().manifest_version).toBe(3);
  });

  it("declares exactly the pinned permission set: storage, sidePanel, activeTab — no more, no less", () => {
    const manifest = readManifest();
    expect(manifest.permissions).toEqual(["storage", "sidePanel", "activeTab"]);
  });

  it("never declares the debugger permission (E1 constitution: no chrome.debugger)", () => {
    const manifest = readManifest();
    const permissions = (manifest.permissions as string[]) ?? [];
    expect(permissions).not.toContain("debugger");
  });

  it("host_permissions is scoped to the app origin only", () => {
    const manifest = readManifest();
    expect(manifest.host_permissions).toEqual(["__APP_ORIGIN__/*"]);
  });

  it("pins a stable extension ID via the key field", () => {
    const manifest = readManifest();
    expect(typeof manifest.key).toBe("string");
    expect((manifest.key as string).length).toBeGreaterThan(100);
  });

  it("has exactly two content-script entries: the L0-mapped ATS hosts (all_frames) and the app origin (handoff)", () => {
    const manifest = readManifest();
    const scripts = manifest.content_scripts as Array<{ matches: string[]; js: string[]; all_frames?: boolean }>;
    expect(scripts).toHaveLength(2);

    const atsScript = scripts.find((s) => s.js.some((f) => f.includes("atsFillBridge")));
    expect(atsScript).toBeDefined();
    expect(atsScript?.all_frames).toBe(true);
    expect(atsScript?.matches).toEqual([
      "*://*.greenhouse.io/*",
      "*://*.lever.co/*",
      "*://*.ashbyhq.com/*",
      "*://*.myworkdayjobs.com/*",
      "*://*.workday.com/*",
    ]);

    const handoffScript = scripts.find((s) => s.js.some((f) => f.includes("handoffRelay")));
    expect(handoffScript).toBeDefined();
    expect(handoffScript?.matches).toEqual(["__APP_ORIGIN__/*"]);
  });

  it("uses chrome.sidePanel, not a default_popup action", () => {
    const manifest = readManifest();
    expect((manifest.side_panel as { default_path: string })?.default_path).toBe("panel.html");
    expect((manifest.action as { default_popup?: string })?.default_popup).toBeUndefined();
  });

  it("background service worker is background.js (bundled as a self-contained IIFE, no import/export)", () => {
    const manifest = readManifest();
    const background = manifest.background as { service_worker: string; type?: string };
    expect(background.service_worker).toBe("background.js");
    expect(background.type).toBeUndefined();
  });
});
