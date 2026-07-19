import { describe, expect, it } from "vitest";
import { AI_COPY_INSTRUCTION, renderDossierCopyBlock, renderDossierMarkdown } from "./exportMarkdown";
import type { DossierViewModel } from "./derive";

const GENERATED_AT = new Date("2026-07-19T12:00:00.000Z");

const FULL_DOSSIER: DossierViewModel = {
  header: {
    name: "Alex Quinn",
    anchorLine: "Staff RF Engineer · Acme · 3 yrs",
    statusLine: "12 of 12 modules · last learned Jul 16",
  },
  mirror: { ready: true, paragraphs: ["You build things that work under pressure."], placeholder: "", source: null },
  facts: {
    anchor: { title: "Staff RF Engineer", company: "Acme", freeText: null, source: null },
    evidence: { provided: true, excerpt: "# CV", source: null },
    skills: ["RF design", "Python"],
    metrics: {
      confirmed: ["Cut latency 40% on the RF pipeline", "Shipped the calibration tool in 6 weeks"],
      heldBackCount: 2,
      source: { moduleKey: "metrics", completedAt: "2026-07-11T10:00:00.000Z", label: "Metrics · Jul 11", href: "/onboarding?module=metrics" },
    },
    logistics: {
      base: "Atlanta, GA",
      remoteAcceptable: true,
      relocation: "no",
      currentCompUsd: 165000,
      targetCompUsd: "180000+",
    },
  },
  wants: {
    values: [{ prompt: "Mission vs prestige", chosen: "Mission", other: "Prestige" }],
    valuesSource: null,
    trajectory: { direction: "climb", note: "want staff -> principal", source: null },
    environment: [{ scenario: "Team size", chosen: "Small" }],
    environmentSource: null,
    dealbreakers: { hard: ["No unpaid overtime"], soft: ["Long commute"], degreeGate: "No degree required", source: null },
    tiers: [{ key: "tier1", label: "Staff RF Engineer", notes: "core target", referenceRole: null }],
  },
  texture: {
    energy: { hoursDisappear: "debugging RF hardware", keptPuttingOff: "expense reports", source: null },
    voice: { register: "dry, compressed", signaturePhrases: ["ship it and see"], source: null },
    reactionTaste: { interestedCount: 1, passedCount: 1, notes: ["great mission"], source: null },
  },
  completeness: { doneCount: 12, totalCount: 12, missingModules: [], lastLearnedAt: "2026-07-16T14:02:00.000Z" },
  validation: { hasIssues: false, bannerText: null, issues: [] },
  events: [
    { label: "Jul 10 — Anchor · Staff RF Engineer · Acme", moduleKey: "anchor", completedAt: "2026-07-10T10:00:00.000Z" },
    { label: "Jul 10 — Reactions · 2 reactions (1 interested)", moduleKey: "reactions", completedAt: "2026-07-10T10:05:00.000Z" },
    { label: "Jul 10 — Values · 1 trade-off answered", moduleKey: "values", completedAt: "2026-07-10T10:10:00.000Z" },
    { label: "Jul 10 — Dealbreakers · 1 hard constraint", moduleKey: "dealbreakers", completedAt: "2026-07-10T10:15:00.000Z" },
    { label: "Jul 11 — Range · 4 answers", moduleKey: "range", completedAt: "2026-07-11T09:00:00.000Z" },
    { label: "Jul 16 — Mirror · accepted", moduleKey: "mirror", completedAt: "2026-07-16T14:02:00.000Z" },
  ],
};

const SPARSE_DOSSIER: DossierViewModel = {
  header: { name: "Your profile", anchorLine: null, statusLine: "1 of 12 modules · last learned —" },
  mirror: { ready: false, paragraphs: [], placeholder: "Your story is still being written.", source: null },
  facts: {
    anchor: { title: null, company: null, freeText: null, source: null },
    evidence: { provided: false, excerpt: null, source: null },
    skills: [],
    metrics: { confirmed: [], heldBackCount: 0, source: null },
    logistics: { base: null, remoteAcceptable: null, relocation: null, currentCompUsd: null, targetCompUsd: null },
  },
  wants: {
    values: [],
    valuesSource: null,
    trajectory: { direction: null, note: null, source: null },
    environment: [],
    environmentSource: null,
    dealbreakers: { hard: [], soft: [], degreeGate: null, source: null },
    tiers: [],
  },
  texture: {
    energy: { hoursDisappear: null, keptPuttingOff: null, source: null },
    voice: { register: null, signaturePhrases: [], source: null },
    reactionTaste: { interestedCount: 0, passedCount: 0, notes: [], source: null },
  },
  completeness: { doneCount: 1, totalCount: 12, missingModules: [], lastLearnedAt: null },
  validation: { hasIssues: false, bannerText: null, issues: [] },
  events: [],
};

describe("renderDossierMarkdown — full profile", () => {
  const md = renderDossierMarkdown(FULL_DOSSIER, GENERATED_AT);

  it("opens with the name and one-line anchor summary", () => {
    expect(md).toContain("# Alex Quinn");
    expect(md).toContain("Staff RF Engineer · Acme · 3 yrs");
  });

  it("renders the three bands as headings", () => {
    expect(md).toContain("## Facts");
    expect(md).toContain("## Wants");
    expect(md).toContain("## Texture");
  });

  it("renders confirmed metrics verbatim, quoted", () => {
    expect(md).toContain('- "Cut latency 40% on the RF pipeline"');
    expect(md).toContain('- "Shipped the calibration tool in 6 weeks"');
    expect(md).toContain("2 numbers held back — never used in materials.");
  });

  it("renders voice notes", () => {
    expect(md).toContain("**Voice:** dry, compressed");
    expect(md).toContain('"ship it and see"');
  });

  it("renders logistics render-what-exists lines", () => {
    expect(md).toContain("Location: Atlanta, GA");
    expect(md).toContain("Remote: Open to remote");
    expect(md).toContain("Comp floor: 180000+");
  });

  it("renders only the last 5 change-log entries, most recent last", () => {
    expect(md).not.toContain("Anchor · Staff RF Engineer · Acme");
    expect(md).toContain("2 reactions (1 interested)");
    expect(md).toContain("accepted");
    const idxFirstKept = md.indexOf("2 reactions (1 interested)");
    const idxLast = md.indexOf("accepted");
    expect(idxFirstKept).toBeLessThan(idxLast);
  });

  it("ends with the exact provenance footer", () => {
    expect(md.trim().endsWith("_Generated from my jobify profile, Jul 19, 2026. Every line traces to my own words._")).toBe(
      true
    );
  });

  it("contains no HTML", () => {
    expect(md).not.toMatch(/<[a-z][\s\S]*>/i);
  });
});

describe("renderDossierMarkdown — sparse profile (render-what-exists, no invented lines)", () => {
  const md = renderDossierMarkdown(SPARSE_DOSSIER, GENERATED_AT);

  it("falls back to the placeholder name with no anchor line", () => {
    expect(md).toContain("# Your profile");
    expect(md.split("\n")[2]).not.toBe("Staff RF Engineer");
  });

  it("states evidence not provided, and invents no other facts lines", () => {
    expect(md).toContain("not provided yet");
    expect(md).not.toContain("**Skills:**");
    expect(md).not.toContain("**Confirmed metrics**");
    expect(md).not.toContain("**Logistics**");
  });

  it("omits every wants sub-section", () => {
    expect(md).not.toContain("**Values**");
    expect(md).not.toContain("**Trajectory:**");
    expect(md).not.toContain("**Environment**");
    expect(md).not.toContain("**Dealbreakers**");
    expect(md).not.toContain("**Target tiers**");
  });

  it("omits every texture sub-section", () => {
    expect(md).not.toContain("**Voice:**");
    expect(md).not.toContain("**Reaction taste:**");
    expect(md).not.toMatch(/^>/m);
  });

  it("omits the change-log section entirely when there are no events", () => {
    expect(md).not.toContain("## Recent changes");
  });

  it("still ends with the provenance footer", () => {
    expect(md.trim().endsWith("Every line traces to my own words._")).toBe(true);
  });
});

describe("renderDossierCopyBlock", () => {
  it("is exactly the instruction header, a blank line, then the same markdown", () => {
    const block = renderDossierCopyBlock(FULL_DOSSIER, GENERATED_AT);
    const md = renderDossierMarkdown(FULL_DOSSIER, GENERATED_AT);
    expect(block).toBe(`${AI_COPY_INSTRUCTION}\n\n${md}`);
  });
});
