/**
 * gen-status-types.mjs — generate the JobStatus TypeScript union from the
 * jobpipe status enum (Session E cross-repo contract).
 *
 * Source of truth: job-pipeline/jobpipe/shared/status.py, exported as
 * jobpipe/shared/status.json. That file is vendored here as
 * app/lib/job-status.json (so Vercel builds don't need the sibling repo)
 * and rendered into app/lib/job-status.generated.ts.
 *
 * Usage:
 *   npm run gen:status   — refresh vendored JSON from ../job-pipeline
 *                          when present, then (re)write the generated TS.
 *
 * The build prechain runs scripts/check-status-types.mjs, which fails the
 * build if the generated TS drifts from the vendored JSON (or the vendored
 * JSON from the sibling repo's, when it's checked out next door).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const VENDORED_JSON = join(ROOT, "app", "lib", "job-status.json");
export const GENERATED_TS = join(ROOT, "app", "lib", "job-status.generated.ts");
// Present in local dev when both repos are checked out side by side;
// absent on Vercel — callers must treat it as optional.
export const SIBLING_JSON = join(
  ROOT, "..", "job-pipeline", "jobpipe", "shared", "status.json",
);

export function renderTs(statusJson) {
  const statuses = statusJson.canonical_statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new Error("status.json has no canonical_statuses array");
  }
  const members = statuses.map((s) => `  "${s}",`).join("\n");
  return `// AUTO-GENERATED from app/lib/job-status.json — do not edit by hand.
// Source of truth: job-pipeline/jobpipe/shared/status.py (Session E).
// Regenerate with \`npm run gen:status\`; the build prechain
// (scripts/check-status-types.mjs) fails if this file drifts.

export const JOB_STATUSES = [
${members}
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
`;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function main() {
  if (existsSync(SIBLING_JSON)) {
    const sibling = readFileSync(SIBLING_JSON, "utf-8");
    writeFileSync(VENDORED_JSON, sibling);
    console.log(`vendored ${SIBLING_JSON} -> ${VENDORED_JSON}`);
  } else {
    console.log("sibling job-pipeline checkout not found; keeping vendored JSON");
  }
  writeFileSync(GENERATED_TS, renderTs(readJson(VENDORED_JSON)));
  console.log(`wrote ${GENERATED_TS}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
