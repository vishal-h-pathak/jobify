import type { FillInstruction, FillReport, SubmitPacket } from "../engineTypes";

export type ChecklistItem = { label: string; status: "filled" | "stuck" | "required_empty" };
export type HandoffLine = { label: string; value: string };

/** Per-field checklist: filled / stuck / required-empty (session prompt build step 4). */
export function buildChecklist(report: FillReport): ChecklistItem[] {
  const items: ChecklistItem[] = report.outcomes.map((o) => ({ label: o.label, status: o.filled ? "filled" : "stuck" }));
  for (const label of report.requiredEmpty) items.push({ label, status: "required_empty" });
  return items;
}

/**
 * The `handoff.py` pattern (`jobify/submit/handoff.py::_build_checklist`),
 * ported to the panel: every field the engine attempted but couldn't fill
 * becomes a copyable "label: value" line, using the exact value the plan
 * would have typed in (sourced from the packet) — so the human can paste it
 * by hand instead of re-deriving it. Fields that were never even attempted
 * because the packet had nothing for them (no matching `FillInstruction`)
 * surface as bare reminders instead, since there's no value to copy.
 */
export function buildHandoffLines(report: FillReport, plan: FillInstruction[]): { valued: HandoffLine[]; reminders: string[] } {
  const valueByFieldId = new Map(plan.map((instruction) => [instruction.fieldId, instruction.value]));
  const valued: HandoffLine[] = [];
  for (const outcome of report.outcomes) {
    if (!outcome.attempted || outcome.filled) continue;
    const value = valueByFieldId.get(outcome.fieldId);
    if (value) valued.push({ label: outcome.label, value });
  }
  return { valued, reminders: [...report.requiredEmpty] };
}

const IDENTITY_LABELS: Record<keyof SubmitPacket["identity"], string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedin_url: "LinkedIn URL",
  github_url: "GitHub URL",
  portfolio_url: "Portfolio URL",
};

const AUTHORIZATION_LABELS: Record<string, string> = {
  work_authorized: "Authorized to work",
  visa_sponsorship_needed: "Needs visa sponsorship",
  notes: "Authorization notes",
};

const LOGISTICS_LABELS: Record<string, string> = {
  notice_period: "Notice period",
  earliest_start: "Earliest start date",
  salary_expectation: "Salary expectation",
};

const SELF_ID_LABELS: Record<string, string> = {
  gender: "Gender",
  race_ethnicity: "Race/ethnicity",
  veteran_status: "Veteran status",
  disability_status: "Disability status",
};

/**
 * The "generic ATS -> pure handoff view" case (build step 4): `planFills`
 * returns `[]` for an unmapped ATS, so there is no survey-derived checklist
 * at all. Instead of showing nothing, dump every non-empty value the
 * packet holds as a copyable line — the human fills the whole page by hand,
 * but at least isn't re-typing from the resume PDF.
 */
export function buildFullPacketHandoffLines(packet: SubmitPacket): HandoffLine[] {
  const lines: HandoffLine[] = [];

  for (const [key, label] of Object.entries(IDENTITY_LABELS) as [keyof SubmitPacket["identity"], string][]) {
    const value = packet.identity[key];
    if (value) lines.push({ label, value });
  }
  if (packet.materials.cover_letter_text) lines.push({ label: "Cover letter", value: packet.materials.cover_letter_text });
  for (const [key, label] of Object.entries(AUTHORIZATION_LABELS)) {
    const value = (packet.authorization as Record<string, string | undefined>)[key];
    if (value) lines.push({ label, value });
  }
  for (const [key, label] of Object.entries(LOGISTICS_LABELS)) {
    const value = (packet.logistics as Record<string, string | undefined>)[key];
    if (value) lines.push({ label, value });
  }
  for (const [key, label] of Object.entries(SELF_ID_LABELS)) {
    const value = (packet.self_id as Record<string, string | undefined>)[key];
    if (value) lines.push({ label, value });
  }

  return lines;
}
