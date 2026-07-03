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
});
