import { describe, expect, it } from "vitest";
import {
  SUBMIT_STEP_ORDER,
  SELF_ID_PRIVACY_COPY,
  nextStepKey,
  prevStepKey,
  stepProgressPercent,
  formValuesFromProfile,
  buildApplicationProfilePayload,
  summarizeApplicationProfile,
  resolveReturnTo,
  EMPTY_APPLICATION_FORM_VALUES,
} from "./wizard";
import type { ApplicationProfile } from "./types";

describe("step navigation", () => {
  it("walks contact -> authorization -> logistics -> self_id -> review -> null", () => {
    let step = SUBMIT_STEP_ORDER[0];
    const visited = [step];
    let next = nextStepKey(step);
    while (next) {
      visited.push(next);
      step = next;
      next = nextStepKey(step);
    }
    expect(visited).toEqual(["contact", "authorization", "logistics", "self_id", "review"]);
  });

  it("prevStepKey walks back to null before the first step", () => {
    expect(prevStepKey("contact")).toBeNull();
    expect(prevStepKey("authorization")).toBe("contact");
    expect(prevStepKey("review")).toBe("self_id");
  });

  it("stepProgressPercent is 20% on step 1 of 5, 100% on the last step", () => {
    expect(stepProgressPercent("contact")).toBe(20);
    expect(stepProgressPercent("review")).toBe(100);
  });
});

describe("self-ID privacy copy", () => {
  it("names encryption, no admin access, and that blanks stay blank", () => {
    expect(SELF_ID_PRIVACY_COPY.toLowerCase()).toContain("encrypted");
    expect(SELF_ID_PRIVACY_COPY.toLowerCase()).toContain("never shown to anyone");
    expect(SELF_ID_PRIVACY_COPY.toLowerCase()).toContain("leaves that box blank");
  });
});

describe("formValuesFromProfile", () => {
  it("a null profile (404, never onboarded) yields all-empty form values", () => {
    expect(formValuesFromProfile(null)).toEqual(EMPTY_APPLICATION_FORM_VALUES);
  });

  it("prefills every field present on the profile", () => {
    const profile: ApplicationProfile = {
      contact: { phone: "555-0100", location: "Atlanta, GA" },
      authorization: { work_authorized: "yes" },
      logistics: { notice_period: "2 weeks" },
      self_id: { veteran_status: "no" },
      updated_at: "2026-07-18T00:00:00Z",
    };
    const values = formValuesFromProfile(profile);
    expect(values.phone).toBe("555-0100");
    expect(values.location).toBe("Atlanta, GA");
    expect(values.work_authorized).toBe("yes");
    expect(values.notice_period).toBe("2 weeks");
    expect(values.veteran_status).toBe("no");
    expect(values.linkedin_url).toBe("");
  });
});

describe("buildApplicationProfilePayload", () => {
  it("an all-blank form saves as an all-empty profile — every field is skippable", () => {
    expect(buildApplicationProfilePayload(EMPTY_APPLICATION_FORM_VALUES)).toEqual({
      contact: {},
      authorization: {},
      logistics: {},
      self_id: {},
    });
  });

  it("omits blank fields but keeps filled ones, trimmed", () => {
    const values = { ...EMPTY_APPLICATION_FORM_VALUES, phone: "  555-0100  ", work_authorized: "yes" as const };
    const payload = buildApplicationProfilePayload(values);
    expect(payload.contact).toEqual({ phone: "555-0100" });
    expect(payload.authorization).toEqual({ work_authorized: "yes" });
  });

  it("round-trips through formValuesFromProfile without gaining or losing filled fields", () => {
    const profile: ApplicationProfile = {
      contact: { phone: "555-0100", location: "Atlanta, GA", linkedin_url: "https://linkedin.com/in/alexquinn" },
      authorization: { work_authorized: "yes", visa_sponsorship_needed: "no", notes: "citizen" },
      logistics: { notice_period: "2 weeks", earliest_start: "2026-08-01", salary_expectation: "$150k+" },
      self_id: { gender: "prefer not to say" },
    };
    const roundTripped = buildApplicationProfilePayload(formValuesFromProfile(profile));
    expect(roundTripped).toEqual(profile);
  });
});

describe("summarizeApplicationProfile", () => {
  it("render-what-exists: a section with nothing filled doesn't appear", () => {
    const profile: ApplicationProfile = {
      contact: { phone: "555-0100" },
      authorization: {},
      logistics: {},
      self_id: {},
    };
    const sections = summarizeApplicationProfile(profile);
    expect(sections).toEqual([{ heading: "Contact", rows: [{ label: "Phone", value: "555-0100" }] }]);
  });

  it("marks the self-ID section voluntary when it has rows", () => {
    const profile: ApplicationProfile = {
      contact: {},
      authorization: {},
      logistics: {},
      self_id: { gender: "woman" },
    };
    const sections = summarizeApplicationProfile(profile);
    expect(sections).toEqual([
      { heading: "Self-identification", voluntary: true, rows: [{ label: "Gender", value: "woman" }] },
    ]);
  });
});

describe("resolveReturnTo", () => {
  it("honors a same-origin relative path", () => {
    expect(resolveReturnTo("/submit/posting-123")).toBe("/submit/posting-123");
  });

  it("falls back to /settings when absent", () => {
    expect(resolveReturnTo(null)).toBe("/settings");
  });

  it("falls back to /settings for a protocol-relative URL — guards against open redirect", () => {
    expect(resolveReturnTo("//evil.example.com")).toBe("/settings");
  });

  it("falls back to /settings for a scheme URL — guards against open redirect", () => {
    expect(resolveReturnTo("https://evil.example.com")).toBe("/settings");
  });
});
