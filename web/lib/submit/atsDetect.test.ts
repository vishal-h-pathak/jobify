import { describe, expect, it } from "vitest";
import { detectAtsKind, type AtsKind } from "./atsDetect";

const CASES: Array<[url: string, want: AtsKind]> = [
  // Ashby — both the "overview" and "/application" URL shapes, plus the
  // ashby_jid query-param shape used when Ashby postings are embedded
  // elsewhere.
  ["https://jobs.ashbyhq.com/acme/1234abcd", "ashby"],
  ["https://jobs.ashbyhq.com/acme/1234abcd/application", "ashby"],
  ["https://boards.example.com/apply?ashby_jid=abc123", "ashby"],

  // Greenhouse — boards / job-boards / apply / embed shapes.
  ["https://boards.greenhouse.io/acme/jobs/1234567", "greenhouse"],
  ["https://job-boards.greenhouse.io/acme/jobs/1234567", "greenhouse"],
  ["https://apply.greenhouse.io/acme/jobs/1234567", "greenhouse"],
  ["https://acme.greenhouse.io/embed/job_app?token=abc", "greenhouse"],

  // Lever — US and EU hosts, overview and /apply shapes.
  ["https://jobs.lever.co/acme/1234abcd", "lever"],
  ["https://jobs.lever.co/acme/1234abcd/apply", "lever"],
  ["https://jobs.eu.lever.co/acme/1234abcd", "lever"],

  // Workday — the myworkdayjobs.com job-board host and the workday.com
  // corporate host both count (the latter substring also matches
  // subdomains like "acme.wd5.myworkday.com", which contains "workday.com").
  ["https://acme.myworkdayjobs.com/en-US/External/job/1234", "workday"],
  ["https://acme.wd5.myworkday.com/wday/cxs/acme/External/job/1234", "workday"],
  ["https://careers.workday.com/acme/job/1234", "workday"],

  // iCIMS.
  ["https://acme.icims.com/jobs/1234/job", "icims"],

  // SmartRecruiters.
  ["https://jobs.smartrecruiters.com/acme/1234567-role-title", "smartrecruiters"],

  // LinkedIn.
  ["https://www.linkedin.com/jobs/view/1234567890", "linkedin"],

  // Case-insensitive matching.
  ["HTTPS://BOARDS.GREENHOUSE.IO/ACME/JOBS/1234567", "greenhouse"],
  ["https://JOBS.LEVER.CO/Acme/1234abcd", "lever"],

  // Unrecognized / Indeed (intentionally narrowed out of this TS port) →
  // generic fallback.
  ["https://www.indeed.com/viewjob?jk=abc123", "generic"],
  ["https://careers.some-unknown-ats.example.com/job/1234", "generic"],
];

describe("detectAtsKind", () => {
  it.each(CASES)("detects %s as %s", (url, want) => {
    expect(detectAtsKind(url)).toBe(want);
  });

  it("falls through to generic for empty string", () => {
    expect(detectAtsKind("")).toBe("generic");
  });

  it("falls through to generic for whitespace-only input", () => {
    expect(detectAtsKind("   ")).toBe("generic");
  });

  it("falls through to generic for null/undefined without throwing", () => {
    expect(detectAtsKind(null)).toBe("generic");
    expect(detectAtsKind(undefined)).toBe("generic");
  });
});
