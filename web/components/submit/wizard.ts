// web/components/submit/wizard.ts
import type { ApplicationProfile } from "./types";

export type SubmitStepKey = "contact" | "authorization" | "logistics" | "self_id" | "review";

export const SUBMIT_STEP_ORDER: readonly SubmitStepKey[] = ["contact", "authorization", "logistics", "self_id", "review"];

export const SUBMIT_STEP_LABELS: Record<SubmitStepKey, string> = {
  contact: "Contact",
  authorization: "Authorization",
  logistics: "Logistics",
  self_id: "Self-identification",
  review: "Review",
};

/** Plain privacy copy (V3C_DESIGN.md §5 / session 39 spec) — leads the self-ID step. */
export const SELF_ID_PRIVACY_COPY =
  "Encrypted at rest, never shown to anyone (including admins) — used only to fill the boxes you'd " +
  "otherwise fill by hand. Leave anything blank and the submitter leaves that box blank.";

export function nextStepKey(current: SubmitStepKey): SubmitStepKey | null {
  const idx = SUBMIT_STEP_ORDER.indexOf(current);
  return SUBMIT_STEP_ORDER[idx + 1] ?? null;
}

export function prevStepKey(current: SubmitStepKey): SubmitStepKey | null {
  const idx = SUBMIT_STEP_ORDER.indexOf(current);
  return idx <= 0 ? null : SUBMIT_STEP_ORDER[idx - 1];
}

export function stepProgressPercent(current: SubmitStepKey): number {
  const idx = SUBMIT_STEP_ORDER.indexOf(current);
  return ((idx + 1) / SUBMIT_STEP_ORDER.length) * 100;
}

export interface ApplicationFormValues {
  phone: string;
  location: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  work_authorized: "" | "yes" | "no";
  visa_sponsorship_needed: "" | "yes" | "no";
  authorization_notes: string;
  notice_period: string;
  earliest_start: string;
  salary_expectation: string;
  gender: string;
  race_ethnicity: string;
  veteran_status: string;
  disability_status: string;
}

export const EMPTY_APPLICATION_FORM_VALUES: ApplicationFormValues = {
  phone: "",
  location: "",
  linkedin_url: "",
  github_url: "",
  portfolio_url: "",
  work_authorized: "",
  visa_sponsorship_needed: "",
  authorization_notes: "",
  notice_period: "",
  earliest_start: "",
  salary_expectation: "",
  gender: "",
  race_ethnicity: "",
  veteran_status: "",
  disability_status: "",
};

/** Prefill: a 404 (never onboarded) means `profile` is null — start blank. */
export function formValuesFromProfile(profile: ApplicationProfile | null): ApplicationFormValues {
  if (!profile) return EMPTY_APPLICATION_FORM_VALUES;
  return {
    phone: profile.contact.phone ?? "",
    location: profile.contact.location ?? "",
    linkedin_url: profile.contact.linkedin_url ?? "",
    github_url: profile.contact.github_url ?? "",
    portfolio_url: profile.contact.portfolio_url ?? "",
    work_authorized: profile.authorization.work_authorized ?? "",
    visa_sponsorship_needed: profile.authorization.visa_sponsorship_needed ?? "",
    authorization_notes: profile.authorization.notes ?? "",
    notice_period: profile.logistics.notice_period ?? "",
    earliest_start: profile.logistics.earliest_start ?? "",
    salary_expectation: profile.logistics.salary_expectation ?? "",
    gender: profile.self_id.gender ?? "",
    race_ethnicity: profile.self_id.race_ethnicity ?? "",
    veteran_status: profile.self_id.veteran_status ?? "",
    disability_status: profile.self_id.disability_status ?? "",
  };
}

/**
 * Every field is skippable (session 39 spec): omit anything blank rather
 * than sending empty strings, so an all-blank save round-trips to `{}`
 * nested objects, not a profile full of `""` values.
 */
export function buildApplicationProfilePayload(values: ApplicationFormValues): ApplicationProfile {
  const contact: ApplicationProfile["contact"] = {};
  if (values.phone.trim()) contact.phone = values.phone.trim();
  if (values.location.trim()) contact.location = values.location.trim();
  if (values.linkedin_url.trim()) contact.linkedin_url = values.linkedin_url.trim();
  if (values.github_url.trim()) contact.github_url = values.github_url.trim();
  if (values.portfolio_url.trim()) contact.portfolio_url = values.portfolio_url.trim();

  const authorization: ApplicationProfile["authorization"] = {};
  if (values.work_authorized) authorization.work_authorized = values.work_authorized;
  if (values.visa_sponsorship_needed) authorization.visa_sponsorship_needed = values.visa_sponsorship_needed;
  if (values.authorization_notes.trim()) authorization.notes = values.authorization_notes.trim();

  const logistics: ApplicationProfile["logistics"] = {};
  if (values.notice_period.trim()) logistics.notice_period = values.notice_period.trim();
  if (values.earliest_start.trim()) logistics.earliest_start = values.earliest_start.trim();
  if (values.salary_expectation.trim()) logistics.salary_expectation = values.salary_expectation.trim();

  const self_id: ApplicationProfile["self_id"] = {};
  if (values.gender.trim()) self_id.gender = values.gender.trim();
  if (values.race_ethnicity.trim()) self_id.race_ethnicity = values.race_ethnicity.trim();
  if (values.veteran_status.trim()) self_id.veteran_status = values.veteran_status.trim();
  if (values.disability_status.trim()) self_id.disability_status = values.disability_status.trim();

  return { contact, authorization, logistics, self_id };
}

export interface ProfileSummaryRow {
  label: string;
  value: string;
}

export interface ProfileSummarySection {
  heading: string;
  voluntary?: boolean;
  rows: ProfileSummaryRow[];
}

const CONTACT_LABELS: Record<keyof ApplicationProfile["contact"], string> = {
  phone: "Phone",
  location: "Location",
  linkedin_url: "LinkedIn",
  github_url: "GitHub",
  portfolio_url: "Portfolio",
};

const AUTHORIZATION_LABELS: Record<keyof ApplicationProfile["authorization"], string> = {
  work_authorized: "Authorized to work",
  visa_sponsorship_needed: "Needs visa sponsorship",
  notes: "Notes",
};

const LOGISTICS_LABELS: Record<keyof ApplicationProfile["logistics"], string> = {
  notice_period: "Notice period",
  earliest_start: "Earliest start",
  salary_expectation: "Salary expectation",
};

const SELF_ID_LABELS: Record<keyof ApplicationProfile["self_id"], string> = {
  gender: "Gender",
  race_ethnicity: "Race / ethnicity",
  veteran_status: "Veteran status",
  disability_status: "Disability status",
};

function rowsFrom<K extends string>(obj: Partial<Record<K, string>>, labels: Record<K, string>): ProfileSummaryRow[] {
  return (Object.keys(labels) as K[])
    .map((key) => ({ label: labels[key], value: (obj[key] ?? "").trim() }))
    .filter((row) => row.value.length > 0);
}

/** Review-step summary: render-what-exists, grouped, self-ID marked voluntary. */
export function summarizeApplicationProfile(profile: ApplicationProfile): ProfileSummarySection[] {
  const sections: ProfileSummarySection[] = [
    { heading: "Contact", rows: rowsFrom(profile.contact, CONTACT_LABELS) },
    { heading: "Authorization", rows: rowsFrom(profile.authorization, AUTHORIZATION_LABELS) },
    { heading: "Logistics", rows: rowsFrom(profile.logistics, LOGISTICS_LABELS) },
    { heading: "Self-identification", voluntary: true, rows: rowsFrom(profile.self_id, SELF_ID_LABELS) },
  ];
  return sections.filter((s) => s.rows.length > 0);
}

/**
 * Guards the post-save redirect against an open redirect via `?returnTo=`:
 * only a same-origin path (`/...`, never `//...`) is honored, else falls
 * back to Settings — the sensible default home for the edit surface.
 */
export function resolveReturnTo(returnTo: string | null): string {
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return "/settings";
}
