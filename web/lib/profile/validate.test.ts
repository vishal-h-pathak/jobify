import { describe, expect, it } from "vitest";
import { validateProfileDoc } from "./validate";

const VALID_DOC: Record<string, string> = {
  "profile.yml": `
identity:
  name: Alex Quinn
  email: alex@example.com
application_defaults:
  work_authorization: ""
  visa_sponsorship_needed: false
  earliest_start_date: ""
  relocation_willingness: ""
  in_person_willingness: ""
  ai_policy_ack: ""
  previous_interview_with_company: {}
`,
  "thesis.md": "# thesis\n\nSomething.",
  "voice-profile.md": "",
  "article-digest.md": "",
  "learned-insights.md": "",
  "cv.md": "# CV",
  "disqualifiers.yml": "hard_disqualifiers: []\nsoft_concerns: []\n",
  "portals.yml": `
greenhouse: { companies: [] }
lever: { companies: [] }
ashby: { companies: [] }
workday: { companies: [] }
title_filter:
  reject_substrings: ["intern"]
  prefer_substrings: ["engineer"]
  seniority_substrings: ["senior"]
`,
};

describe("validateProfileDoc", () => {
  it("accepts a complete minimal doc", () => {
    const result = validateProfileDoc(VALID_DOC);
    expect(result.status).toBe("valid");
    expect(result.errors).toEqual([]);
  });

  it("errors when profile.yml is missing identity", () => {
    const doc = { ...VALID_DOC, "profile.yml": "application_defaults: {}\n" };
    const result = validateProfileDoc(doc);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.includes("identity"))).toBe(true);
  });

  it("errors when application_defaults is missing required keys", () => {
    const doc = {
      ...VALID_DOC,
      "profile.yml": `
identity:
  name: A
  email: a@example.com
application_defaults:
  work_authorization: ""
`,
    };
    const result = validateProfileDoc(doc);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.includes("application_defaults"))).toBe(true);
  });

  it("errors when previous_interview_with_company is not an object", () => {
    const doc = {
      ...VALID_DOC,
      "profile.yml": `
identity:
  name: A
  email: a@example.com
application_defaults:
  work_authorization: ""
  visa_sponsorship_needed: false
  earliest_start_date: ""
  relocation_willingness: ""
  in_person_willingness: ""
  ai_policy_ack: ""
  previous_interview_with_company: "nope"
`,
    };
    const result = validateProfileDoc(doc);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.includes("previous_interview_with_company"))).toBe(true);
  });

  it("warns (not errors) when disqualifiers.yml / portals.yml are empty", () => {
    const doc = { ...VALID_DOC, "disqualifiers.yml": "", "portals.yml": "" };
    const result = validateProfileDoc(doc);
    expect(result.status).toBe("valid");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("errors when portals.yml title_filter is missing a required key", () => {
    const doc = {
      ...VALID_DOC,
      "portals.yml": `
greenhouse: { companies: [] }
lever: { companies: [] }
ashby: { companies: [] }
workday: { companies: [] }
title_filter:
  reject_substrings: ["intern"]
  prefer_substrings: ["engineer"]
`,
    };
    const result = validateProfileDoc(doc);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.includes("title_filter"))).toBe(true);
  });

  it("errors when voice-profile.md is non-empty with no '## ' section", () => {
    const doc = { ...VALID_DOC, "voice-profile.md": "just some prose, no headings" };
    const result = validateProfileDoc(doc);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.includes("voice-profile.md"))).toBe(true);
  });
});
