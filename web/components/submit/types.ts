// web/components/submit/types.ts
//
// PINNED CONTRACT (planning/session-prompts/39_v3c0_submit_kit.md) — shared
// verbatim with session 40, which owns the routes that implement it. Do not
// change these shapes unilaterally; a mismatch breaks integration at merge.

export interface ApplicationProfile {
  contact: {
    phone?: string;
    location?: string;
    linkedin_url?: string;
    github_url?: string;
    portfolio_url?: string;
  };
  authorization: {
    work_authorized?: "yes" | "no";
    visa_sponsorship_needed?: "yes" | "no";
    notes?: string;
  };
  logistics: {
    notice_period?: string;
    earliest_start?: string;
    salary_expectation?: string;
  };
  self_id: {
    gender?: string;
    race_ethnicity?: string;
    veteran_status?: string;
    disability_status?: string;
  };
  updated_at?: string;
}

export interface SubmitPacket {
  posting: { id: string; title: string; company: string; application_url: string; ats_kind: string };
  identity: {
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
    phone: string;
    location: string;
    linkedin_url: string;
    github_url: string;
    portfolio_url: string;
  };
  materials: { resume_pdf_url: string; cover_letter_pdf_url: string; cover_letter_text: string };
  authorization: ApplicationProfile["authorization"];
  logistics: ApplicationProfile["logistics"];
  self_id: ApplicationProfile["self_id"];
  meta: { tailor_run_id: string; doc_sha256: string | null; generated_at: string };
}
