/**
 * V3C-PACKET pinned contract (`planning/session-prompts/40_v3c_packet.md`,
 * shared verbatim with session 39 / `39_v3c0_submit_kit.md`) — copied
 * field-for-field, do not retype from paraphrase. `ApplicationProfile` is
 * the shape `web/lib/submit/applicationProfile.ts` sanitizes, encrypts, and
 * stores; `SubmitPacket` is assembled later (Task 5,
 * `web/lib/submit/packet.ts`) from a decrypted `ApplicationProfile` plus
 * posting/tailor-run/identity data. Both live here together per the pinned
 * block, even though this task only consumes `ApplicationProfile`.
 */

export type ApplicationProfile = {
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
  updated_at?: string; // set server-side on save; every field optional
};

export type SubmitPacket = {
  posting: {
    id: string;
    title: string;
    company: string;
    application_url: string;
    ats_kind: string;
  };
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
  }; // missing = "" (render-what-exists)
  materials: {
    resume_pdf_url: string;
    cover_letter_pdf_url: string;
    cover_letter_text: string;
  }; // short-lived signed URLs
  authorization: ApplicationProfile["authorization"];
  logistics: ApplicationProfile["logistics"];
  self_id: ApplicationProfile["self_id"];
  meta: { tailor_run_id: string; doc_sha256: string | null; generated_at: string };
};
