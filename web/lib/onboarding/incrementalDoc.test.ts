import { describe, expect, it } from "vitest";
import { applyModuleToDoc, buildMinimalDoc, type MinimalDocInput } from "./incrementalDoc";
import { validateProfileDoc } from "../profile/validate";

const FIXTURE_EXTRACTED: MinimalDocInput = {
  anchor: { current_title: "Senior Backend Engineer", current_company: "Acme Corp", years_in_role: "6 years" },
  reactions: [
    { posting_id: "p1", title: "Staff Platform Engineer", company: "Globex", reaction: "interested" },
    { posting_id: "p2", title: "ML Ops Engineer", company: "Initech", reaction: "not_interested", note: "too research-heavy" },
  ],
  values: [{ prompt: "Mission vs prestige", chosen: "Mission", other: "Prestige" }],
  dealbreakers: {
    hard_disqualifiers: ["Crypto / Web3"],
    soft_concerns: ["Very early-stage startups"],
    degree_gate: "No PhD required.",
  },
};

describe("buildMinimalDoc", () => {
  it("produces all eight files", () => {
    const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex@example.com");
    expect(Object.keys(doc).sort()).toEqual(
      [
        "profile.yml",
        "thesis.md",
        "voice-profile.md",
        "article-digest.md",
        "learned-insights.md",
        "cv.md",
        "disqualifiers.yml",
        "portals.yml",
      ].sort()
    );
  });

  it("passes the TS validator's REQUIRED checks", () => {
    const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex@example.com");
    const result = validateProfileDoc(doc);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("valid");
  });

  it("still validates from anchor + dealbreakers alone (values/reactions optional at the type level)", () => {
    const doc = buildMinimalDoc(
      { anchor: { current_title: "Engineer" }, dealbreakers: { hard_disqualifiers: [] } },
      "alex@example.com"
    );
    expect(validateProfileDoc(doc).status).toBe("valid");
  });

  it("writes profile.yml identity from anchor + auth email", () => {
    const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex@example.com");
    expect(doc["profile.yml"]).toContain("email: alex@example.com");
  });

  it("writes a non-empty cv.md provenance stub when no resume exists yet", () => {
    const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex@example.com");
    expect(doc["cv.md"]).toMatch(/no resume provided yet/);
    expect(doc["cv.md"].trim()).not.toBe("");
  });

  it("thesis.md contains the values trade-off and reaction sections", () => {
    const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex@example.com");
    expect(doc["thesis.md"]).toMatch(/^#\s+\S/); // top-level title present
    expect(doc["thesis.md"]).toContain("Mission vs prestige");
    expect(doc["thesis.md"]).toContain("chose Mission over Prestige");
    expect(doc["thesis.md"]).toContain("Staff Platform Engineer");
    expect(doc["thesis.md"]).toContain("too research-heavy");
  });

  it("thesis.md contains the dealbreakers' hard constraints", () => {
    const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex@example.com");
    expect(doc["thesis.md"]).toContain("Crypto / Web3");
    expect(doc["thesis.md"]).toContain("No PhD required.");
  });

  it("ships voice-profile / article-digest / learned-insights empty (stubs, out of phase-1 scope)", () => {
    const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex@example.com");
    expect(doc["voice-profile.md"]).toBe("");
    expect(doc["article-digest.md"]).toBe("");
    expect(doc["learned-insights.md"]).toBe("");
  });

  it("portals.yml title_filter prefers the anchor role, not the employer", () => {
    const doc = buildMinimalDoc(FIXTURE_EXTRACTED, "alex@example.com");
    expect(doc["portals.yml"]).toContain("Senior Backend Engineer");
    expect(doc["portals.yml"]).not.toContain("Acme Corp");
  });
});

describe("applyModuleToDoc", () => {
  function baseDoc(): Record<string, string> {
    return buildMinimalDoc({}, "alex@example.com");
  }

  it("is pure — never mutates the input doc", () => {
    const doc = baseDoc();
    const frozen = { ...doc };
    applyModuleToDoc(doc, "values", { choices: [{ prompt: "a", chosen: "b" }] });
    expect(doc).toEqual(frozen);
  });

  it("is deterministic — same input always produces the same output", () => {
    const doc = baseDoc();
    const extracted = { choices: [{ prompt: "Mission vs prestige", chosen: "Mission", other: "Prestige" }] };
    const once = applyModuleToDoc(doc, "values", extracted);
    const twice = applyModuleToDoc(doc, "values", extracted);
    expect(once).toEqual(twice);
  });

  it("re-submitting a module's section replaces it in place, never duplicates it", () => {
    let doc = baseDoc();
    doc = applyModuleToDoc(doc, "values", { choices: [{ prompt: "Mission vs prestige", chosen: "Mission" }] });
    doc = applyModuleToDoc(doc, "values", { choices: [{ prompt: "Mission vs prestige", chosen: "Prestige" }] });
    const occurrences = doc["thesis.md"].match(/## What matters \(chosen under trade-off\)/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(doc["thesis.md"]).toContain("chose Prestige");
    expect(doc["thesis.md"]).not.toContain("chose Mission");
  });

  it("applying one module's section leaves other modules' sections untouched", () => {
    let doc = baseDoc();
    doc = applyModuleToDoc(doc, "dealbreakers", { hard_disqualifiers: ["Crypto"], soft_concerns: [] });
    doc = applyModuleToDoc(doc, "values", { choices: [{ prompt: "Mission vs prestige", chosen: "Mission" }] });
    expect(doc["thesis.md"]).toContain("Crypto");
    expect(doc["thesis.md"]).toContain("Mission");
  });

  it("energy/environment/trajectory render their own thesis sections", () => {
    let doc = baseDoc();
    doc = applyModuleToDoc(doc, "energy", { hours_disappear: "debugging prod incidents", kept_putting_off: "docs" });
    doc = applyModuleToDoc(doc, "environment", { choices: [{ scenario: "team size", chosen: "small" }] });
    doc = applyModuleToDoc(doc, "trajectory", { direction: "climb", note: "wants more scope" });
    expect(doc["thesis.md"]).toContain("## Energy signals");
    expect(doc["thesis.md"]).toContain("debugging prod incidents");
    expect(doc["thesis.md"]).toContain("## Environment preferences");
    expect(doc["thesis.md"]).toContain("small");
    expect(doc["thesis.md"]).toContain("## Trajectory");
    expect(doc["thesis.md"]).toContain("climb");
    expect(validateProfileDoc(doc).status).toBe("valid");
  });

  it("no-ops for modules with no extractor yet (range/evidence/voice/metrics/mirror)", () => {
    const doc = baseDoc();
    for (const key of ["range", "evidence", "voice", "metrics", "mirror"] as const) {
      expect(applyModuleToDoc(doc, key, { anything: "goes" })).toEqual(doc);
    }
  });

  it("re-applying anchor refreshes profile.yml + portals.yml without dropping dealbreakers", () => {
    let doc = baseDoc();
    doc = applyModuleToDoc(doc, "dealbreakers", { hard_disqualifiers: ["Crypto"], soft_concerns: [] });
    doc = applyModuleToDoc(doc, "anchor", { current_title: "Staff Engineer" });
    expect(doc["profile.yml"]).toContain("Staff Engineer");
    expect(doc["disqualifiers.yml"]).toContain("Crypto");
    expect(doc["portals.yml"]).toContain("Staff Engineer");
  });
});
