// web/lib/submit/atsDetect.ts — TS port of the ATS URL-detection heuristics.
//
// Ports + merges (union of substring patterns per ATS):
//   - jobify/shared/ats_detect.py::detect_ats            (broad baseline)
//   - jobify/submit/adapters/prepare_dom/greenhouse.py::GreenhouseApplicant.detect
//   - jobify/submit/adapters/prepare_dom/lever.py::LeverApplicant.detect
//   - jobify/submit/adapters/prepare_dom/ashby.py::AshbyApplicant.detect
//
// Only the 8 kinds the pinned `SubmitPacket.posting.ats_kind` contract cares
// about — no `indeed` branch (the Python baseline has one; this TS port
// intentionally narrows to what Task 5 needs, so an Indeed URL falls through
// to "generic"). Case-insensitive substring matching, same defensive style as
// the Python originals: `(url || "").toLowerCase()` before any comparison.
// Pure function, no I/O — this only classifies whatever URL string it's given;
// aggregator URL *resolution* is a later, out-of-scope phase.

export type AtsKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "smartrecruiters"
  | "linkedin"
  | "generic";

export function detectAtsKind(url: string | null | undefined): AtsKind {
  const urlLower = (url || "").toLowerCase();

  // Ashby — union of ats_detect.py ("ashby", "ashbyhq.com", "ashby_jid") and
  // ashby.py ("ashbyhq.com", "ashby_jid", "jobs.ashby").
  if (
    urlLower.includes("ashby") ||
    urlLower.includes("ashbyhq.com") ||
    urlLower.includes("ashby_jid") ||
    urlLower.includes("jobs.ashby")
  ) {
    return "ashby";
  }

  // Greenhouse — union of ats_detect.py ("greenhouse.io", "boards.greenhouse",
  // "job-boards.greenhouse") and greenhouse.py ("boards.greenhouse.io",
  // "job-boards.greenhouse.io", "apply.greenhouse.io",
  // "greenhouse.io/embed/job_app").
  if (
    urlLower.includes("greenhouse.io") ||
    urlLower.includes("boards.greenhouse") ||
    urlLower.includes("job-boards.greenhouse") ||
    urlLower.includes("apply.greenhouse.io") ||
    urlLower.includes("greenhouse.io/embed/job_app")
  ) {
    return "greenhouse";
  }

  // Lever — union of ats_detect.py ("lever.co", "jobs.lever") and lever.py
  // ("jobs.lever.co", "jobs.eu.lever.co").
  if (
    urlLower.includes("lever.co") ||
    urlLower.includes("jobs.lever") ||
    urlLower.includes("jobs.eu.lever")
  ) {
    return "lever";
  }

  // Workday — ats_detect.py only (no per-ATS adapter exists yet).
  if (urlLower.includes("myworkdayjobs.com") || urlLower.includes("workday.com")) {
    return "workday";
  }

  // LinkedIn — ats_detect.py only.
  if (urlLower.includes("linkedin.com")) {
    return "linkedin";
  }

  // iCIMS — ats_detect.py only.
  if (urlLower.includes("icims.com")) {
    return "icims";
  }

  // SmartRecruiters — ats_detect.py only.
  if (urlLower.includes("smartrecruiters.com")) {
    return "smartrecruiters";
  }

  return "generic";
}
