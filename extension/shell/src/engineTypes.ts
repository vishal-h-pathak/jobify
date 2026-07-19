// PINNED CONTRACT — shared verbatim with session 41
// (`planning/session-prompts/41_v3c_e1_engine.md`'s pinned block). Session 41
// owns `extension/engine/**` and implements this exact API in a sibling
// worktree that does not exist here; session 42 (this package) consumes it
// exactly. Do not add fields, do not rename anything below — a mismatch here
// is a contract break, not a local style choice.
//
// The engine's actual public API (`survey`, `planFills`, `executeFills`) is
// consumed through `EngineApi` (engineApi.ts), not imported directly from
// most of this package — see that file's header comment for why.

export type SurveyField = {
  id: string; // stable within one survey pass: "f1","f2",...
  kind: "text" | "textarea" | "select" | "combobox" | "radio_group" | "checkbox" | "file" | "date" | "unknown";
  label: string; // best label via the resolution ladder
  name: string; // name attribute or ""
  autocomplete: string; // autocomplete attribute or ""
  required: boolean;
  value: string; // current value; radio_group -> checked option label or ""
  options?: string[]; // select/combobox/radio_group visible labels
  frame: string; // "" = main document; else frame path like "iframe0/iframe1"
  automationId?: string; // data-automation-id when present (Workday)
};

export type SurveyButton = { id: string; label: string; kind: "button" | "submit" | "link" };

export type Survey = { url: string; fields: SurveyField[]; buttons: SurveyButton[] };

export type FillInstruction = { fieldId: string; value: string; source: string }; // source = packet key ("identity.phone") or file key ("materials.resume_pdf")

export type FillOutcome = {
  fieldId: string;
  label: string;
  layer: "map";
  attempted: boolean;
  filled: boolean;
  stuckAfterReadback: boolean;
  strategy: string;
};

export type FillReport = { outcomes: FillOutcome[]; requiredEmpty: string[] };

export type AtsMapKind = "greenhouse" | "lever" | "ashby" | "workday";

export type EngineFiles = { resume?: File; cover_letter?: File };

// `ApplicationProfile` is not itself part of the pinned contract, but
// `SubmitPacket` below references three of its fields by index type
// (`ApplicationProfile["authorization"]` etc.) in the canonical source
// (`web/lib/submit/types.ts`) — copied verbatim here only so that
// `SubmitPacket`'s own text can be copied verbatim too, keeping the
// byte-for-byte drift test (`submitPacket.driftTest.test.ts`) meaningful.
type ApplicationProfile = {
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

// `SubmitPacket` — the engine carries its own verbatim copy of this type too
// (per its pinned block); this package owns the drift test asserting both
// copies (and the canonical `web/lib/submit/types.ts` source) stay
// byte-identical — see `submitPacket.driftTest.test.ts`.
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
