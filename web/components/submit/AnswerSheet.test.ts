import { describe, expect, it } from "vitest";
import { answerSheetSections } from "./AnswerSheet";
import type { SubmitPacket } from "./types";

const BASE_META = { tailor_run_id: "run-1", doc_sha256: null, generated_at: "2026-07-18T00:00:00Z" };
const BASE_POSTING = {
  id: "p1",
  title: "Staff Engineer",
  company: "Acme",
  application_url: "https://acme.example/apply",
  ats_kind: "greenhouse",
};
const BASE_MATERIALS = {
  resume_pdf_url: "https://sign/resume.pdf",
  cover_letter_pdf_url: "https://sign/cl.pdf",
  cover_letter_text: "Dear hiring team,",
};

describe("answerSheetSections", () => {
  it("full packet: every section renders with all its rows, self-ID marked voluntary", () => {
    const packet: SubmitPacket = {
      posting: BASE_POSTING,
      identity: {
        first_name: "Alex",
        last_name: "Quinn",
        full_name: "Alex Quinn",
        email: "alex@example.com",
        phone: "555-0100",
        location: "Atlanta, GA",
        linkedin_url: "https://linkedin.com/in/alexquinn",
        github_url: "https://github.com/alexquinn",
        portfolio_url: "https://alexquinn.dev",
      },
      materials: BASE_MATERIALS,
      authorization: { work_authorized: "yes", visa_sponsorship_needed: "no", notes: "US citizen" },
      logistics: { notice_period: "2 weeks", earliest_start: "2026-08-01", salary_expectation: "$150k+" },
      self_id: { gender: "woman", race_ethnicity: "prefer not to say", veteran_status: "no", disability_status: "no" },
      meta: BASE_META,
    };
    const sections = answerSheetSections(packet);
    expect(sections.map((s) => s.key)).toEqual(["identity", "authorization", "logistics", "self_id"]);
    expect(sections.find((s) => s.key === "identity")?.rows).toHaveLength(9);
    expect(sections.find((s) => s.key === "self_id")?.voluntary).toBe(true);
  });

  it("sparse packet: only sections with non-empty values render, exactly their non-empty rows", () => {
    const packet: SubmitPacket = {
      posting: BASE_POSTING,
      identity: {
        first_name: "Alex",
        last_name: "Quinn",
        full_name: "Alex Quinn",
        email: "alex@example.com",
        phone: "",
        location: "",
        linkedin_url: "",
        github_url: "",
        portfolio_url: "",
      },
      materials: BASE_MATERIALS,
      authorization: { work_authorized: "yes" },
      logistics: {},
      self_id: {},
      meta: BASE_META,
    };
    const sections = answerSheetSections(packet);
    expect(sections.map((s) => s.key)).toEqual(["identity", "authorization"]);
    expect(sections.find((s) => s.key === "identity")?.rows).toEqual([
      { label: "First name", value: "Alex" },
      { label: "Last name", value: "Quinn" },
      { label: "Full name", value: "Alex Quinn" },
      { label: "Email", value: "alex@example.com" },
    ]);
    expect(sections.find((s) => s.key === "authorization")?.rows).toEqual([
      { label: "Authorized to work", value: "yes" },
    ]);
  });

  it("empty self-ID: the self-identification section doesn't render at all", () => {
    const packet: SubmitPacket = {
      posting: BASE_POSTING,
      identity: {
        first_name: "Alex",
        last_name: "Quinn",
        full_name: "Alex Quinn",
        email: "alex@example.com",
        phone: "555-0100",
        location: "",
        linkedin_url: "",
        github_url: "",
        portfolio_url: "",
      },
      materials: BASE_MATERIALS,
      authorization: {},
      logistics: {},
      self_id: {},
      meta: BASE_META,
    };
    const sections = answerSheetSections(packet);
    expect(sections.some((s) => s.key === "self_id")).toBe(false);
  });
});
