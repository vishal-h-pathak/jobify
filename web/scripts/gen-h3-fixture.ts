/**
 * Regenerates `tests/fixtures/h3_profile_doc.json` from a fixed, mocked
 * interview `ExtractedState` run through the real `buildProfileDoc()`.
 *
 * `tests/fixtures/h3_profile_doc.json` backs
 * `tests/test_h3_onboarding_doc_fixture.py`, the cross-language check that
 * feeds a real `buildProfileDoc()` output through the authoritative Python
 * validator (`onboarding/validate_profile.py`). Per that test's docstring,
 * the fixture was originally "dumped once via `npx tsx`, not hand-authored"
 * — this script is that dump, made repeatable.
 *
 * ONB-A (2026-07-05): regenerated for the v2 flow (anchor -> calibration ->
 * resume, now optional -> targeting). `FIXTURE_EXTRACTED` deliberately
 * SKIPS the resume stage, so the fixture also exercises `buildDoc.ts`'s
 * synthesized-cv.md path (§2 stage 3) end to end through the real Python
 * validator — not just the resume-provided path already covered by
 * `buildDoc.test.ts`.
 *
 * IMPORTANT: `FIXTURE_EXTRACTED` below was NOT copied from
 * `buildDoc.test.ts`'s `FULL_EXTRACTED`/`ANCHOR_ONLY` literals — it's its
 * own persona data, only similar in shape. Running
 * `buildProfileDoc(FULL_EXTRACTED)` would NOT reproduce this fixture
 * byte-for-byte. If you need to intentionally regenerate the fixture with
 * different mocked interview data, update `FIXTURE_EXTRACTED` here
 * directly.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildProfileDoc, type ExtractedState } from "../lib/profile/buildDoc";

const FIXTURE_EXTRACTED: ExtractedState = {
  anchor: {
    current_title: "Senior Backend Engineer",
    current_company: "Acme Corp",
    years_in_role: "6 years",
  },
  calibration: {
    prompts: [
      "A payment webhook starts silently dropping events under load. Walk me through how you'd handle it — a few sentences.",
      "Which parts of the job around backend engineering do you get pulled into?",
      "If your next role were outside backend engineering work, what would you want it to be — and what carries over?",
      "Describe one piece of work you'd actually show someone — what it was, what you did, what happened.",
    ],
    skills: ["Go", "Python", "TypeScript", "PostgreSQL", "Kafka", "Kubernetes"],
    evidence: ["Cut p99 latency from 4s to 300ms on a payments service running at 20k events/sec."],
    range_statement:
      "Open to platform/infrastructure work outside a pure backend title; less interested in pure data-science roles.",
    background_summary:
      "Backend and platform engineer with ~8 years building and operating high-throughput services.",
  },
  identity: {
    name: "Alex Quinn",
    email: "alex.quinn@example.com",
    phone: "+1-555-0142",
    location_base: "Denver, CO",
    linkedin: "linkedin.com/in/alexquinn-example",
    location_and_compensation: {
      base: "Denver, CO",
      remote_acceptable: true,
      in_person_acceptable: "hybrid acceptable in/near Denver; remote preferred",
      relocation: "open to relocation for an exceptional role + comp package",
      current_comp_usd: 165000,
      target_comp_usd: "175000-205000",
    },
  },
  targeting: {
    tiers: [
      {
        key: "tier_1",
        label: "Platform / infrastructure / distributed-systems engineering",
        notes: "Owning developer-facing platforms, infra, or core services at scale.",
        reference_role: "Staff Platform Engineer at a mid-size product company",
      },
      {
        key: "tier_2",
        label: "ML / data-platform engineering (the systems around models, not the models)",
        notes: "Feature stores, training/serving infra, data pipelines.",
      },
    ],
    hard_disqualifiers: [
      "Crypto / Web3 / trading products",
      "Below-market compensation (a pay cut from current total comp)",
      "Defense / weapons work",
    ],
    soft_concerns: [
      "Very early-stage startups with no senior engineers to learn from",
      "Fully in-office with no remote flexibility",
    ],
    degree_gate: "No PhD required — open to any role that does not gate on an advanced degree.",
    thesis_summary:
      "Backend/platform engineer seeking infra-ownership roles at product companies with real " +
      "scale and a healthy engineering culture; open to ML-platform roles as a strong second lane.",
  },
};

function main(): void {
  const doc = buildProfileDoc(FIXTURE_EXTRACTED);
  const outPath = path.resolve(__dirname, "../../tests/fixtures/h3_profile_doc.json");
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf-8");
  console.log(`Wrote ${path.relative(path.resolve(__dirname, "../.."), outPath)}`);
}

main();
