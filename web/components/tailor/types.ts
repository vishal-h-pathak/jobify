import type { PolledTailorRun } from "@/lib/tailor/pollRuns";

export interface SourceRef {
  file: string;
  quote: string;
  start_line?: number;
  end_line?: number;
}

export interface NumberToken {
  token: string;
  basis: string;
}

export type ClaimUnitKind = "bullet" | "skill" | "header" | "edu" | "summary" | "cl_sentence" | "voice";
export type ClaimUnitStatus = "verified" | "user_edited";

export interface ClaimUnit {
  id: string;
  surface: "resume" | "cover_letter";
  kind: ClaimUnitKind;
  text?: string;
  sources?: SourceRef[];
  fields?: Record<string, string>;
  numbers?: NumberToken[];
  status: ClaimUnitStatus;
}

export type DroppedReason = "number_not_confirmed" | "missing_span" | "new_entity";

export interface DroppedUnit {
  id: string;
  text: string;
  reason: DroppedReason;
}

export interface ClaimsJson {
  version: 1;
  doc_sha256: string;
  units: ClaimUnit[];
  dropped: DroppedUnit[];
}

export interface TailoredProject {
  name: string | null;
  period: string;
  bullets: string[];
}

export interface TailoredExperience {
  org: string;
  title: string;
  location: string;
  period: string;
  projects: TailoredProject[];
}

export interface TailoredEducation {
  school: string;
  degree: string;
  period: string;
}

export interface TailoredResume {
  skills: Record<string, string>;
  skills_layout?: "auto" | "compact" | "wide" | "stacked" | null;
  experience: TailoredExperience[];
  education: TailoredEducation[];
  summary_line: string | null;
}

export const DROPPED_REASON_COPY: Record<DroppedReason, string> = {
  number_not_confirmed: "number not in your confirmed metrics",
  missing_span: "no matching line in your profile",
  new_entity: "mentions something not in your profile",
};

export const TAILOR_STAGES: Array<{ step: string; label: string }> = [
  { step: "profile", label: "reading your profile" },
  { step: "frame", label: "choosing the frame" },
  { step: "resume", label: "drafting the resume" },
  { step: "cover_letter", label: "writing the cover letter" },
  { step: "verify", label: "checking every claim against your profile" },
  { step: "render", label: "rendering PDFs" },
];

export interface TemplateOption {
  id: string;
  label: string;
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
  { id: "classic", label: "Classic" },
  { id: "modern", label: "Modern" },
  { id: "compact", label: "Compact" },
  { id: "accent", label: "Accent" },
  { id: "executive", label: "Executive" },
];

export type TailorCardState =
  | { kind: "tailorable" }
  | { kind: "generating"; runId: string }
  | { kind: "materials"; runId: string };

/**
 * Derives the match-card's tailor affordance from its runs (already
 * newest-first, matching what `GET /api/tailor/runs?posting_id=` returns).
 * An active run always wins over an older succeeded one — only one run can
 * be active per posting (the DB's unique partial index), so this never has
 * to arbitrate between two simultaneously-active runs.
 */
export function deriveTailorState(runs: Pick<PolledTailorRun, "id" | "status">[]): TailorCardState {
  const active = runs.find((r) => r.status === "queued" || r.status === "running");
  if (active) return { kind: "generating", runId: active.id };
  const succeeded = runs.find((r) => r.status === "succeeded");
  if (succeeded) return { kind: "materials", runId: succeeded.id };
  return { kind: "tailorable" };
}
