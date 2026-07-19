// extension/engine/src/types.ts — the survey is the lingua franca (§3.1).
//
// Pinned contract, shared verbatim with session 42
// (`planning/session-prompts/41_v3c_e1_engine.md` /
// `42_v3c_e1_shell.md`) — do not retype from paraphrase.

export type SurveyField = {
  id: string;                    // stable within one survey pass: "f1","f2",...
  kind: "text"|"textarea"|"select"|"combobox"|"radio_group"|"checkbox"|"file"|"date"|"unknown";
  label: string;                 // best label via the resolution ladder
  name: string;                  // name attribute or ""
  autocomplete: string;          // autocomplete attribute or ""
  required: boolean;
  value: string;                 // current value; radio_group -> checked option label or ""
  options?: string[];            // select/combobox/radio_group visible labels
  frame: string;                 // "" = main document; else frame path like "iframe0/iframe1"
  automationId?: string;         // data-automation-id when present (Workday)
};
export type SurveyButton = { id: string; label: string; kind: "button"|"submit"|"link" };
export type Survey = { url: string; fields: SurveyField[]; buttons: SurveyButton[] };

export type FillInstruction = { fieldId: string; value: string; source: string }; // source = packet key ("identity.phone") or file key ("materials.resume_pdf")
export type FillOutcome = { fieldId: string; label: string; layer: "map";
  attempted: boolean; filled: boolean; stuckAfterReadback: boolean; strategy: string };
export type FillReport = { outcomes: FillOutcome[]; requiredEmpty: string[] };

export type AtsMapKind = "greenhouse"|"lever"|"ashby"|"workday";
export type EngineFiles = { resume?: File; cover_letter?: File };

// ---------------------------------------------------------------------------
// SubmitPacket pinned contract — copied verbatim from `web/lib/submit/types.ts`
// (V3C-PACKET, session 40). The extension cannot import from `web/`; a drift
// test in session 42 keeps the two files identical.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The engine's ENTIRE public API — nothing else is exported from the package
// root (see src/index.ts + constitution.test.ts).
// ---------------------------------------------------------------------------
//   export function survey(root: Document): Survey;
//   export function planFills(s: Survey, packet: SubmitPacket, ats: AtsMapKind | "generic"): FillInstruction[];
//   export function executeFills(root: Document, s: Survey, plan: FillInstruction[], files: EngineFiles): Promise<FillReport>;
