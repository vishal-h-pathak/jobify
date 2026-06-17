/**
 * check-status-types.mjs — build-prechain half of the Session E status
 * contract. Fails the build (exit 1) when:
 *
 *   1. app/lib/job-status.generated.ts doesn't match what
 *      gen-status-types.mjs would render from app/lib/job-status.json
 *      (someone hand-edited the generated file or the vendored JSON), or
 *   2. the sibling job-pipeline checkout exists locally and its
 *      jobpipe/shared/status.json differs from the vendored copy
 *      (the enum changed upstream — re-run `npm run gen:status`).
 *
 * On Vercel the sibling repo is absent, so only check 1 runs there; the
 * jobpipe side of the contract (tests/test_status_contract.py) pins its
 * JSON to the Python enum, so the two CIs together close the loop.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  GENERATED_TS,
  SIBLING_JSON,
  VENDORED_JSON,
  readJson,
  renderTs,
} from "./gen-status-types.mjs";

let failed = false;

const expected = renderTs(readJson(VENDORED_JSON));
const actual = readFileSync(GENERATED_TS, "utf-8");
if (actual !== expected) {
  console.error(
    "✗ app/lib/job-status.generated.ts drifted from app/lib/job-status.json.\n" +
      "  Re-run `npm run gen:status` and commit the result.",
  );
  failed = true;
}

if (existsSync(SIBLING_JSON)) {
  const sibling = JSON.stringify(readJson(SIBLING_JSON));
  const vendored = JSON.stringify(readJson(VENDORED_JSON));
  if (sibling !== vendored) {
    console.error(
      "✗ vendored app/lib/job-status.json drifted from " +
        "../job-pipeline/jobpipe/shared/status.json.\n" +
        "  Re-run `npm run gen:status` and commit the result.",
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log("✓ status types match the canonical enum");
