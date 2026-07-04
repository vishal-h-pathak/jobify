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
 * IMPORTANT: `FIXTURE_EXTRACTED` below was reverse-engineered from the
 * checked-in fixture content, NOT copied from `buildDoc.test.ts`'s
 * `FULL_EXTRACTED`. The two literals look similar (same "Alex Quinn"
 * persona, same shape) but are NOT the same data — `FULL_EXTRACTED` in the
 * unit test is a smaller, simpler stand-in (e.g. it has no `phone`,
 * `linkedin`, `current_comp_usd`, `in_person_acceptable`, `relocation`, or
 * second tier, and its `cv_markdown`/`thesis_summary`/disqualifiers are all
 * shorter placeholder strings). Running `buildProfileDoc(FULL_EXTRACTED)`
 * would NOT reproduce the checked-in fixture byte-for-byte. If you need to
 * intentionally regenerate the fixture with a different mocked interview,
 * update `FIXTURE_EXTRACTED` here directly (and it will then diverge from
 * `buildDoc.test.ts`'s `FULL_EXTRACTED`, which is fine — they serve
 * different purposes).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildProfileDoc, type ExtractedState } from "../lib/profile/buildDoc";

const FIXTURE_EXTRACTED: ExtractedState = {
  resume: {
    cv_markdown:
      "# Alex Quinn\n\n" +
      "## Experience\n\n" +
      "### Senior Backend Engineer, Acme Corp (2019-2025)\n" +
      "- Built and operated high-throughput payment services.\n" +
      "- Cut p99 latency from 4s to 300ms at 20k events/sec.\n\n" +
      "## Education\n\n" +
      "B.S. Computer Science, State University\n\n" +
      "## Skills\n\n" +
      "Go, Python, TypeScript, PostgreSQL, Kafka, Kubernetes",
    key_technical_skills: ["Go", "Python", "TypeScript", "PostgreSQL", "Kafka", "Kubernetes"],
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
