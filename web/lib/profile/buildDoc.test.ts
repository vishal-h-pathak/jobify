import { describe, expect, it } from "vitest";
import { buildProfileDoc, type ExtractedState } from "./buildDoc";
import { validateProfileDoc } from "./validate";

const FULL_EXTRACTED: ExtractedState = {
  resume: {
    cv_markdown: "# CV\n\n## Experience\n\n- Did things.",
    key_technical_skills: ["TypeScript", "Python"],
    background_summary: "Backend engineer who likes systems.",
  },
  identity: {
    name: "Alex Quinn",
    email: "alex@example.com",
    location_base: "Denver, CO",
    location_and_compensation: {
      base: "Denver, CO",
      remote_acceptable: true,
      target_comp_usd: "175000-205000",
    },
  },
  targeting: {
    tiers: [{ key: "tier_1", label: "Platform engineering", notes: "Owning infra at scale" }],
    dream_companies: ["Stripe"],
    hard_disqualifiers: ["Crypto / Web3"],
    soft_concerns: ["Very early-stage startups"],
    degree_gate: "No PhD required roles.",
    thesis_summary: "Wants platform/infra roles with real ownership.",
  },
};

describe("buildProfileDoc", () => {
  it("produces all eight files", () => {
    const doc = buildProfileDoc(FULL_EXTRACTED);
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

  it("ships voice-profile / article-digest / learned-insights empty (out of v1 scope)", () => {
    const doc = buildProfileDoc(FULL_EXTRACTED);
    expect(doc["voice-profile.md"]).toBe("");
    expect(doc["article-digest.md"]).toBe("");
    expect(doc["learned-insights.md"]).toBe("");
  });

  it("never writes application_defaults content the interview didn't ask for", () => {
    const doc = buildProfileDoc(FULL_EXTRACTED);
    expect(doc["profile.yml"]).toContain("work_authorization: ''");
    expect(doc["profile.yml"]).not.toMatch(/work_authorization:\s*(us_citizen|visa_holder)/);
  });

  it("seeds a non-empty title_filter even from a single tier", () => {
    const doc = buildProfileDoc(FULL_EXTRACTED);
    expect(doc["portals.yml"]).toMatch(/reject_substrings:\n\s*- /);
    expect(doc["portals.yml"]).toMatch(/prefer_substrings:\n\s*- Platform engineering/);
  });

  it("passes the TS validator end to end", () => {
    const doc = buildProfileDoc(FULL_EXTRACTED);
    const result = validateProfileDoc(doc);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("valid");
  });

  it("still validates with only the minimum required fields (sparse interview)", () => {
    const sparse: ExtractedState = {
      identity: { name: "A", email: "a@example.com" },
      targeting: {
        tiers: [{ key: "tier_1", label: "Anything backend" }],
        hard_disqualifiers: [],
        soft_concerns: [],
        thesis_summary: "Open to anything backend-shaped.",
      },
    };
    const doc = buildProfileDoc(sparse);
    const result = validateProfileDoc(doc);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("valid");
  });

  it("ONB-A: leaves cv.md empty when neither resume nor anchor is present (defensive/edge state)", () => {
    const doc = buildProfileDoc({
      identity: { name: "A", email: "a@example.com" },
      targeting: FULL_EXTRACTED.targeting,
    });
    expect(doc["cv.md"]).toBe("");
  });
});

describe("ONB-A: buildProfileDoc — synthesized cv.md when resume is skipped", () => {
  const ANCHOR_ONLY: ExtractedState = {
    anchor: { current_title: "Senior Backend Engineer", current_company: "Acme Corp", years_in_role: "4 years" },
    calibration: {
      skills: ["Go", "Postgres"],
      evidence: ["Cut p99 latency from 4s to 300ms on the payments service."],
      range_statement: "Open to adjacent platform work.",
      background_summary: "Backend engineer who owns high-throughput services.",
    },
    targeting: FULL_EXTRACTED.targeting,
  };

  it("synthesizes cv.md from anchor + calibration with the provenance header", () => {
    const doc = buildProfileDoc(ANCHOR_ONLY);
    expect(doc["cv.md"]).toContain("# CV — assembled from onboarding interview (no resume provided)");
    expect(doc["cv.md"]).toContain("## Senior Backend Engineer — Acme Corp (4 years)");
    expect(doc["cv.md"]).toContain("Cut p99 latency from 4s to 300ms on the payments service.");
    expect(doc["cv.md"]).toContain("Go, Postgres");
  });

  it("falls back to the anchor's free-text description when no title/company (no-title escape path)", () => {
    const doc = buildProfileDoc({
      anchor: { free_text: "Final-year CS student, internships in backend dev" },
      calibration: ANCHOR_ONLY.calibration,
      targeting: FULL_EXTRACTED.targeting,
    });
    expect(doc["cv.md"]).toContain("## Final-year CS student, internships in backend dev");
  });

  it("uses the real resume's cv_markdown instead of synthesizing when a resume was provided", () => {
    const doc = buildProfileDoc({ ...ANCHOR_ONLY, resume: FULL_EXTRACTED.resume });
    expect(doc["cv.md"]).toBe(FULL_EXTRACTED.resume!.cv_markdown);
    expect(doc["cv.md"]).not.toContain("assembled from onboarding interview");
  });

  it("falls back to calibration's skills/background_summary in profile.yml when there's no resume", () => {
    const doc = buildProfileDoc(ANCHOR_ONLY);
    expect(doc["profile.yml"]).toContain("Backend engineer who owns high-throughput services.");
    expect(doc["profile.yml"]).toMatch(/key_technical_skills:\n\s*- Go\n\s*- Postgres/);
  });

  it("seeds portals.yml title_filter with the anchor's current_title", () => {
    const doc = buildProfileDoc(ANCHOR_ONLY);
    expect(doc["portals.yml"]).toMatch(/prefer_substrings:\n(\s*- .+\n)*\s*- Senior Backend Engineer/);
  });

  it("still passes the TS validator with a synthesized cv.md", () => {
    const doc = buildProfileDoc(ANCHOR_ONLY);
    const result = validateProfileDoc(doc);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("valid");
  });
});
