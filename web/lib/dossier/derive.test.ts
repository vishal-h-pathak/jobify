import { describe, expect, it } from "vitest";
import { deriveDossier } from "./derive";
import type { ModulesState } from "../onboarding/moduleRegistry";
import { buildMinimalDoc } from "../onboarding/incrementalDoc";

const t = (iso: string) => new Date(iso).toISOString();

const FULL_MODULES: ModulesState = {
  anchor: { completed_at: t("2026-07-10T10:00:00Z"), receipt: "Staff RF Engineer · Acme" },
  reactions: { completed_at: t("2026-07-10T10:05:00Z"), receipt: "2 reactions (1 interested)" },
  values: { completed_at: t("2026-07-10T10:10:00Z"), receipt: "1 trade-off answered" },
  dealbreakers: { completed_at: t("2026-07-10T10:15:00Z"), receipt: "1 hard constraint" },
  checkpoint_hunt: { fired_at: t("2026-07-10T10:16:00Z") },
  range: { completed_at: t("2026-07-11T09:00:00Z"), receipt: "4 answers" },
  energy: { completed_at: t("2026-07-11T09:10:00Z"), receipt: "debugging RF hardware" },
  environment: { completed_at: t("2026-07-11T09:20:00Z"), receipt: "1 environment preference" },
  trajectory: { completed_at: t("2026-07-11T09:30:00Z"), receipt: "climb" },
  evidence: { completed_at: t("2026-07-11T09:40:00Z"), receipt: "resume added" },
  voice: { completed_at: t("2026-07-11T09:50:00Z"), receipt: "voice: dry, compressed" },
  metrics: { completed_at: t("2026-07-11T10:00:00Z"), receipt: "2 confirmed · 2 held back" },
  mirror: { completed_at: t("2026-07-16T14:02:00Z"), receipt: "accepted" },
};

const FULL_EXTRACTED: Record<string, unknown> = {
  anchor: { current_title: "Staff RF Engineer", current_company: "Acme", years_in_role: "3" },
  reactions: [
    { posting_id: "p1", title: "RF Engineer II", company: "Beta Co", reaction: "interested", note: "great mission" },
    { posting_id: "p2", title: "Firmware Eng", company: "Gamma", reaction: "not_interested" },
  ],
  values: [{ prompt: "Mission vs prestige", chosen: "Mission", other: "Prestige" }],
  dealbreakers: { hard_disqualifiers: ["No unpaid overtime"], soft_concerns: ["Long commute"] },
  energy: { hours_disappear: "debugging RF hardware", kept_putting_off: "expense reports" },
  environment: [{ scenario: "Structured vs ambiguous", chosen: "Structured" }],
  trajectory: { direction: "climb", note: "want staff -> principal" },
  voice: {
    register: "dry, compressed",
    rhythm: "short sentences",
    words_used: ["build"],
    words_avoided: ["synergy"],
    signature_phrases: ["ship it and see"],
    sample: "raw sample text",
  },
  identity: {
    name: "Alex Quinn",
    email: "alex@example.com",
    location_and_compensation: {
      base: "Atlanta, GA",
      remote_acceptable: true,
      relocation: "no",
      current_comp_usd: 165000,
      target_comp_usd: "180000+",
    },
  },
  targeting: {
    tiers: [{ key: "tier1", label: "Staff RF Engineer", notes: "core target" }],
    dream_companies: ["Acme"],
    hard_disqualifiers: [],
    soft_concerns: [],
    thesis_summary: "Staff RF engineer chasing depth over breadth.",
  },
};

const FULL_DOC: Record<string, string> = {
  "profile.yml": [
    "identity:",
    "  name: Alex Quinn",
    "  email: alex@example.com",
    "application_defaults:",
    "  work_authorization: ''",
    "  visa_sponsorship_needed: false",
    "  earliest_start_date: ''",
    "  relocation_willingness: ''",
    "  in_person_willingness: ''",
    "  ai_policy_ack: ''",
    "  previous_interview_with_company: {}",
    "",
  ].join("\n"),
  "thesis.md": [
    "# Hunting thesis",
    "",
    "You build things that work under pressure, and you'd rather ship it and see than",
    "polish something no one asked for.",
    "",
    "You choose depth over breadth every time a trade-off forces the question.",
    "",
    "## What matters (chosen under trade-off)",
    "",
    "- **Mission vs prestige**: chose Mission over Prestige",
  ].join("\n"),
  "voice-profile.md": "# voice-profile\n\nregister: dry, compressed\n",
  "article-digest.md": [
    "# article-digest",
    "",
    "## Confirmed metrics",
    "- Cut latency 40% on the RF pipeline",
    "- Shipped the calibration tool in 6 weeks",
    "",
    "## Never use",
    "- \"saved $2M\" (unverifiable)",
    "- \"10x productivity\" (unverifiable)",
  ].join("\n"),
  "learned-insights.md": "",
  "cv.md": ["# CV", "", "## Skills", "", "- RF design", "- Python", ""].join("\n"),
  "disqualifiers.yml": "hard_disqualifiers:\n  - No unpaid overtime\nsoft_concerns:\n  - Long commute\n",
  "portals.yml": "greenhouse: {}\nlever: {}\nashby: {}\nworkday: {}\ntitle_filter: {}\n",
};

const VALID_STATUS = { status: "valid" as const, errors: [] as string[] };

describe("deriveDossier — full profile", () => {
  const dossier = deriveDossier({
    doc: FULL_DOC,
    validationStatus: VALID_STATUS,
    modules: FULL_MODULES,
    extracted: FULL_EXTRACTED,
  });

  it("derives the header from identity + anchor", () => {
    expect(dossier.header.name).toBe("Alex Quinn");
    expect(dossier.header.anchorLine).toBe("Staff RF Engineer · Acme · 3 yrs");
  });

  it("derives the status line from completeness + last-learned date", () => {
    expect(dossier.header.statusLine).toBe("12 of 12 modules · last learned Jul 16");
  });

  it("marks the mirror ready and parses the accepted paragraphs", () => {
    expect(dossier.mirror.ready).toBe(true);
    expect(dossier.mirror.paragraphs).toEqual([
      "You build things that work under pressure, and you'd rather ship it and see than\npolish something no one asked for.",
      "You choose depth over breadth every time a trade-off forces the question.",
    ]);
    expect(dossier.mirror.source?.moduleKey).toBe("mirror");
  });

  it("derives confirmed/held-back metrics from article-digest.md", () => {
    expect(dossier.facts.metrics.confirmed).toEqual([
      "Cut latency 40% on the RF pipeline",
      "Shipped the calibration tool in 6 weeks",
    ]);
    expect(dossier.facts.metrics.heldBackCount).toBe(2);
    expect(dossier.facts.metrics.source?.moduleKey).toBe("metrics");
  });

  it("derives skills from cv.md's Skills section", () => {
    expect(dossier.facts.skills).toEqual(["RF design", "Python"]);
  });

  it("marks evidence as provided once the module is complete", () => {
    expect(dossier.facts.evidence.provided).toBe(true);
    expect(dossier.facts.evidence.source?.moduleKey).toBe("evidence");
  });

  it("derives logistics from targeting's location_and_compensation", () => {
    expect(dossier.facts.logistics.base).toBe("Atlanta, GA");
    expect(dossier.facts.logistics.remoteAcceptable).toBe(true);
    expect(dossier.facts.logistics.currentCompUsd).toBe(165000);
    expect(dossier.facts.logistics.targetCompUsd).toBe("180000+");
  });

  it("derives WANTS values/environment/trajectory/dealbreakers/tiers", () => {
    expect(dossier.wants.values).toEqual([{ prompt: "Mission vs prestige", chosen: "Mission", other: "Prestige" }]);
    expect(dossier.wants.environment).toEqual([{ scenario: "Structured vs ambiguous", chosen: "Structured" }]);
    expect(dossier.wants.trajectory.direction).toBe("climb");
    expect(dossier.wants.dealbreakers.hard).toEqual(["No unpaid overtime"]);
    expect(dossier.wants.dealbreakers.soft).toEqual(["Long commute"]);
    expect(dossier.wants.tiers).toEqual([
      { key: "tier1", label: "Staff RF Engineer", notes: "core target", referenceRole: null },
    ]);
  });

  it("derives TEXTURE energy/voice/reaction-taste", () => {
    expect(dossier.texture.energy.hoursDisappear).toBe("debugging RF hardware");
    expect(dossier.texture.voice.register).toBe("dry, compressed");
    expect(dossier.texture.voice.signaturePhrases).toEqual(["ship it and see"]);
    expect(dossier.texture.reactionTaste).toEqual({
      interestedCount: 1,
      passedCount: 1,
      notes: ["great mission"],
      source: dossier.texture.reactionTaste.source,
    });
    expect(dossier.texture.reactionTaste.source?.moduleKey).toBe("reactions");
  });

  it("reports full completeness with no missing modules", () => {
    expect(dossier.completeness).toEqual({
      doneCount: 12,
      totalCount: 12,
      missingModules: [],
      lastLearnedAt: FULL_MODULES.mirror!.completed_at,
    });
  });

  it("reports no validation issues", () => {
    expect(dossier.validation).toEqual({ hasIssues: false, bannerText: null, issues: [] });
  });

  it("emits one change-log event per completed module, sorted by completed_at", () => {
    expect(dossier.events).toHaveLength(12);
    expect(dossier.events[0]).toEqual({
      label: "Jul 10 — Anchor · Staff RF Engineer · Acme",
      moduleKey: "anchor",
      completedAt: FULL_MODULES.anchor!.completed_at,
    });
    expect(dossier.events[dossier.events.length - 1]).toEqual({
      label: "Jul 16 — Mirror · accepted",
      moduleKey: "mirror",
      completedAt: FULL_MODULES.mirror!.completed_at,
    });
  });

  it("builds a source-chip deep link to /onboarding?module=<key>", () => {
    expect(dossier.wants.valuesSource).toEqual({
      moduleKey: "values",
      completedAt: FULL_MODULES.values!.completed_at,
      label: "Values · Jul 10",
      href: "/onboarding?module=values",
    });
  });
});

describe("deriveDossier — checkpoint-minimal profile (phase 1 only)", () => {
  const modules: ModulesState = {
    anchor: { completed_at: t("2026-07-10T10:00:00Z"), receipt: "Staff RF Engineer · Acme" },
    reactions: { completed_at: t("2026-07-10T10:05:00Z"), receipt: "0 reactions (0 interested)" },
    values: { completed_at: t("2026-07-10T10:10:00Z"), receipt: "0 trade-offs answered" },
    dealbreakers: { completed_at: t("2026-07-10T10:15:00Z"), receipt: "no hard constraints" },
    checkpoint_hunt: { fired_at: t("2026-07-10T10:16:00Z") },
  };
  const extracted = {
    anchor: { current_title: "Staff RF Engineer", current_company: "Acme" },
    reactions: [],
    values: [],
    dealbreakers: { hard_disqualifiers: [], soft_concerns: [] },
  };
  const doc = buildMinimalDoc(
    { anchor: extracted.anchor, reactions: [], values: [], dealbreakers: extracted.dealbreakers },
    "alex@example.com"
  );
  const dossier = deriveDossier({ doc, validationStatus: VALID_STATUS, modules, extracted });

  it("counts only the 4 completed phase-1 modules", () => {
    expect(dossier.completeness.doneCount).toBe(4);
    expect(dossier.completeness.totalCount).toBe(12);
    expect(dossier.completeness.missingModules).toHaveLength(8);
  });

  it("shows the mirror placeholder, not ready", () => {
    expect(dossier.mirror.ready).toBe(false);
    expect(dossier.mirror.paragraphs).toEqual([]);
    expect(dossier.mirror.placeholder).toBe("Your story is still being written.");
  });

  it("leaves texture voice + facts metrics empty (no extractor yet)", () => {
    expect(dossier.texture.voice).toEqual({ register: null, signaturePhrases: [], source: null });
    expect(dossier.facts.metrics).toEqual({ confirmed: [], heldBackCount: 0, source: null });
  });

  it("marks evidence not provided (no evidence module yet)", () => {
    expect(dossier.facts.evidence.provided).toBe(false);
    expect(dossier.facts.evidence.source).toBeNull();
  });

  it("emits no change-log events beyond the change-log stub copy", () => {
    expect(dossier.events).toHaveLength(4);
  });
});

describe("deriveDossier — missing modules mid-way (mirror not reached)", () => {
  const { mirror: _mirror, voice: _voice, metrics: _metrics, ...modulesWithoutFinalPhase } = FULL_MODULES;
  const { voice: _voiceExtracted, ...extractedWithoutVoice } = FULL_EXTRACTED;
  const dossier = deriveDossier({
    doc: FULL_DOC,
    validationStatus: VALID_STATUS,
    modules: modulesWithoutFinalPhase,
    extracted: extractedWithoutVoice,
  });

  it("reports the 3 missing modules by key", () => {
    expect(dossier.completeness.doneCount).toBe(9);
    expect(dossier.completeness.missingModules.sort()).toEqual(["metrics", "mirror", "voice"]);
  });

  it("keeps the mirror unready even though thesis.md has intro text", () => {
    expect(dossier.mirror.ready).toBe(false);
    expect(dossier.mirror.paragraphs).toEqual([]);
  });

  it("last-learned reflects the latest remaining completion, not mirror's", () => {
    expect(dossier.completeness.lastLearnedAt).toBe(FULL_MODULES.evidence!.completed_at);
  });
});

describe("deriveDossier — invalid profile", () => {
  const invalidStatus = {
    status: "invalid" as const,
    errors: [
      "profile.yml: 'identity' missing required key(s): email",
      "disqualifiers.yml: missing required key(s): hard_disqualifiers, soft_concerns",
      "portals.yml: missing required key(s): greenhouse",
    ],
  };
  const dossier = deriveDossier({
    doc: FULL_DOC,
    validationStatus: invalidStatus,
    modules: FULL_MODULES,
    extracted: FULL_EXTRACTED,
  });

  it("surfaces a plain-words banner, never the raw validator strings", () => {
    expect(dossier.validation.hasIssues).toBe(true);
    expect(dossier.validation.bannerText).toBe("3 sections need attention");
    for (const issue of dossier.validation.issues) {
      expect(issue.message).not.toMatch(/missing required key/i);
    }
  });

  it("maps each offending file to a plain-words section + fix link", () => {
    expect(dossier.validation.issues).toEqual([
      { section: "profile.yml", message: expect.any(String), fixHref: "/onboarding?module=anchor" },
      { section: "disqualifiers.yml", message: expect.any(String), fixHref: "/onboarding?module=dealbreakers" },
      { section: "portals.yml", message: expect.any(String), fixHref: "/onboarding?module=values" },
    ]);
  });
});

describe("deriveDossier — no validation_status yet (unchecked)", () => {
  it("treats a null validation_status as no issues, not invalid", () => {
    const dossier = deriveDossier({
      doc: FULL_DOC,
      validationStatus: null,
      modules: FULL_MODULES,
      extracted: FULL_EXTRACTED,
    });
    expect(dossier.validation).toEqual({ hasIssues: false, bannerText: null, issues: [] });
  });
});
