/**
 * Regenerates `tests/fixtures/v3a_minimal_profile_doc.json` from a fixed,
 * mocked phase-1 `MinimalDocInput` run through the real `buildMinimalDoc()`.
 *
 * Mirrors `gen-h3-fixture.ts`'s pattern exactly (V3A-1 session prompt's exit
 * criteria: "dump the doc to a dir and run the real validator once in CI via
 * a small pytest") — this is the cross-language check that TS's
 * `validateProfileDoc` and the Python contract (`onboarding/validate_profile.py`)
 * agree that a phase-1-only doc is valid, backing
 * `tests/test_v3a_onboarding_doc_fixture.py`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildMinimalDoc, type MinimalDocInput } from "../lib/onboarding/incrementalDoc";

const FIXTURE_EXTRACTED: MinimalDocInput = {
  anchor: {
    current_title: "Senior Backend Engineer",
    current_company: "Acme Corp",
    years_in_role: "6 years",
  },
  reactions: [
    { posting_id: "posting-1", title: "Staff Platform Engineer", company: "Globex", reaction: "interested" },
    { posting_id: "posting-2", title: "ML Ops Engineer", company: "Initech", reaction: "not_interested", note: "too research-heavy" },
    { posting_id: "posting-3", title: "Infra Engineer", company: "Umbrella", reaction: "interested", note: "great scale" },
    { posting_id: "posting-4", title: "Support Engineer", company: "Hooli", reaction: "not_interested" },
    { posting_id: "posting-5", title: "Platform Lead", company: "Soylent", reaction: "interested" },
    { posting_id: "posting-6", title: "Data Engineer", company: "Vehement", reaction: "not_interested" },
  ],
  values: [
    { prompt: "Mission vs prestige", chosen: "Mission", other: "Prestige" },
    { prompt: "Predictable 40 vs variable 50 + equity", chosen: "Variable 50 + equity", other: "Predictable 40" },
    { prompt: "Deep specialist vs generalist", chosen: "Deep specialist", other: "Generalist" },
  ],
  dealbreakers: {
    hard_disqualifiers: ["Crypto / Web3 / trading products", "Defense / weapons work"],
    soft_concerns: ["Fully in-office with no remote flexibility"],
    degree_gate: "No PhD required.",
  },
};

function main(): void {
  const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex.quinn@example.com");
  const outPath = path.resolve(__dirname, "../../tests/fixtures/v3a_minimal_profile_doc.json");
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf-8");
  console.log(`Wrote ${path.relative(path.resolve(__dirname, "../.."), outPath)}`);
}

main();
