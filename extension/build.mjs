#!/usr/bin/env node
// extension/build.mjs — the one command (`npm run build`) that bundles
// engine/ (session 41's fill engine, `extension/engine/src/index.ts`) and
// shell/ (this session — manifest, auth, panel, fill-flow orchestration)
// into `extension/dist/`, a directory Chrome can load unpacked.
//
// Config (SUPABASE_URL/SUPABASE_ANON_KEY/APP_ORIGIN) is public, build-time
// data, not a secret — the anon key is the same value every browser tab
// already receives via web/lib/supabase/browser.ts (RLS is the real
// security boundary). Fails loud if any of the three env vars is missing,
// same "soft-default only for secrets, fail-loud for everything else"
// posture as jobify.config.
import { build } from "esbuild";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const ENGINE_ENTRY = path.join(ROOT, "engine", "src", "index.ts");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`build.mjs: missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv("JOBIFY_SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("JOBIFY_SUPABASE_ANON_KEY");
const APP_ORIGIN = requireEnv("JOBIFY_APP_ORIGIN");

if (!existsSync(ENGINE_ENTRY)) {
  console.error(
    `build.mjs: ${ENGINE_ENTRY} not found. extension/engine/** is session 41's deliverable (planning/session-prompts/41_v3c_e1_engine.md) — ` +
      "this build only produces a real dist/ once that branch is merged alongside this one. " +
      "(Standalone development in this package uses `cd shell && npx vitest run` / `npx tsc --noEmit`, which never need the real engine.)"
  );
  process.exit(1);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
mkdirSync(path.join(DIST, "content"), { recursive: true });

const define = {
  "process.env.JOBIFY_SUPABASE_URL": JSON.stringify(SUPABASE_URL),
  "process.env.JOBIFY_SUPABASE_ANON_KEY": JSON.stringify(SUPABASE_ANON_KEY),
  "process.env.JOBIFY_APP_ORIGIN": JSON.stringify(APP_ORIGIN),
};

const alias = { "jobify-engine": ENGINE_ENTRY };

const entryPoints = [
  { in: path.join(ROOT, "shell", "src", "background", "index.ts"), out: "background" },
  { in: path.join(ROOT, "shell", "src", "content", "handoffRelay.ts"), out: "content/handoffRelay" },
  { in: path.join(ROOT, "shell", "src", "content", "atsFillBridge.ts"), out: "content/atsFillBridge" },
  { in: path.join(ROOT, "shell", "src", "panel", "panel.ts"), out: "panel" },
];

await build({
  entryPoints,
  outdir: DIST,
  bundle: true,
  format: "iife", // classic scripts everywhere — no manifest "type":"module" needed
  target: "chrome110",
  define,
  alias,
  sourcemap: true,
  logLevel: "info",
});

// manifest.json: substitute the __APP_ORIGIN__ placeholder with the real
// origin's match-pattern prefix (scheme + host, no path) in both
// host_permissions and the handoff content-script's matches.
const manifestSrc = readFileSync(path.join(ROOT, "manifest.json"), "utf8");
const appOriginOrigin = new URL(APP_ORIGIN).origin; // normalizes to "https://host[:port]", no trailing slash
const manifestOut = manifestSrc.replaceAll("__APP_ORIGIN__", appOriginOrigin);
writeFileSync(path.join(DIST, "manifest.json"), manifestOut);

copyFileSync(path.join(ROOT, "shell", "src", "panel", "panel.html"), path.join(DIST, "panel.html"));
copyFileSync(path.join(ROOT, "shell", "src", "panel", "panel.css"), path.join(DIST, "panel.css"));

console.log(`build.mjs: wrote ${DIST}`);
