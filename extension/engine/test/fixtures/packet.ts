import type { SubmitPacket } from "../../src/types.js";

/** A complete Alex Quinn SubmitPacket for tests — never a real person's data. */
export function alexQuinnPacket(overrides?: Partial<SubmitPacket>): SubmitPacket {
  const base: SubmitPacket = {
    posting: {
      id: "posting-1",
      title: "Senior Engineer",
      company: "Acme Corp",
      application_url: "https://boards.greenhouse.io/acme/jobs/1",
      ats_kind: "greenhouse",
    },
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
    materials: {
      resume_pdf_url: "https://storage.example.com/job-materials/alex/posting-1/resume.pdf?sig=abc",
      cover_letter_pdf_url: "https://storage.example.com/job-materials/alex/posting-1/cover_letter.pdf?sig=abc",
      cover_letter_text: "Dear Hiring Team,\n\nI'm excited to apply for this role.\n\nBest,\nAlex Quinn",
    },
    authorization: {},
    logistics: {},
    self_id: {},
    meta: { tailor_run_id: "run-1", doc_sha256: null, generated_at: "2026-07-19T00:00:00Z" },
  };
  return { ...base, ...overrides };
}
