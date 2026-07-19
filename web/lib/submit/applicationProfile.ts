import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "@/lib/crypto/keys";
import type { Database } from "@/lib/supabase/types";
import type { ApplicationProfile } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function yesNoField(source: Record<string, unknown>, key: string): "yes" | "no" | undefined {
  const value = source[key];
  return value === "yes" || value === "no" ? value : undefined;
}

function sanitizeContact(input: unknown): ApplicationProfile["contact"] {
  if (!isPlainObject(input)) return {};
  const out: ApplicationProfile["contact"] = {};
  const phone = stringField(input, "phone");
  if (phone !== undefined) out.phone = phone;
  const location = stringField(input, "location");
  if (location !== undefined) out.location = location;
  const linkedinUrl = stringField(input, "linkedin_url");
  if (linkedinUrl !== undefined) out.linkedin_url = linkedinUrl;
  const githubUrl = stringField(input, "github_url");
  if (githubUrl !== undefined) out.github_url = githubUrl;
  const portfolioUrl = stringField(input, "portfolio_url");
  if (portfolioUrl !== undefined) out.portfolio_url = portfolioUrl;
  return out;
}

function sanitizeAuthorization(input: unknown): ApplicationProfile["authorization"] {
  if (!isPlainObject(input)) return {};
  const out: ApplicationProfile["authorization"] = {};
  const workAuthorized = yesNoField(input, "work_authorized");
  if (workAuthorized !== undefined) out.work_authorized = workAuthorized;
  const visaSponsorshipNeeded = yesNoField(input, "visa_sponsorship_needed");
  if (visaSponsorshipNeeded !== undefined) out.visa_sponsorship_needed = visaSponsorshipNeeded;
  const notes = stringField(input, "notes");
  if (notes !== undefined) out.notes = notes;
  return out;
}

function sanitizeLogistics(input: unknown): ApplicationProfile["logistics"] {
  if (!isPlainObject(input)) return {};
  const out: ApplicationProfile["logistics"] = {};
  const noticePeriod = stringField(input, "notice_period");
  if (noticePeriod !== undefined) out.notice_period = noticePeriod;
  const earliestStart = stringField(input, "earliest_start");
  if (earliestStart !== undefined) out.earliest_start = earliestStart;
  const salaryExpectation = stringField(input, "salary_expectation");
  if (salaryExpectation !== undefined) out.salary_expectation = salaryExpectation;
  return out;
}

function sanitizeSelfId(input: unknown): ApplicationProfile["self_id"] {
  if (!isPlainObject(input)) return {};
  const out: ApplicationProfile["self_id"] = {};
  const gender = stringField(input, "gender");
  if (gender !== undefined) out.gender = gender;
  const raceEthnicity = stringField(input, "race_ethnicity");
  if (raceEthnicity !== undefined) out.race_ethnicity = raceEthnicity;
  const veteranStatus = stringField(input, "veteran_status");
  if (veteranStatus !== undefined) out.veteran_status = veteranStatus;
  const disabilityStatus = stringField(input, "disability_status");
  if (disabilityStatus !== undefined) out.disability_status = disabilityStatus;
  return out;
}

/**
 * Manual `isPlainObject`/`typeof` guards, no Zod (repo convention, see
 * `app/api/profile/route.ts`). Picks only the pinned `ApplicationProfile`
 * shape's keys and drops everything else — nothing but this shape is ever
 * stored. Every field is optional: a missing or malformed sub-object
 * becomes `{}`, and a wrong-typed leaf field is simply omitted rather than
 * defaulted to `""`. `updated_at` is never read from `input` — it's always
 * stamped server-side by `saveApplicationProfile`.
 */
export function sanitizeApplicationProfile(input: unknown): ApplicationProfile {
  const source = isPlainObject(input) ? input : {};
  return {
    contact: sanitizeContact(source.contact),
    authorization: sanitizeAuthorization(source.authorization),
    logistics: sanitizeLogistics(source.logistics),
    self_id: sanitizeSelfId(source.self_id),
  };
}

/**
 * Reads and decrypts the caller's own `application_profiles` row via the
 * service-role client (the table has no `authenticated` RLS policy at
 * all — callers must authenticate before calling this). Returns `null`
 * when the user has never saved a profile.
 */
export async function loadApplicationProfile(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<ApplicationProfile | null> {
  const { data, error } = await admin
    .from("application_profiles")
    .select("encrypted_payload")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return decryptJson<ApplicationProfile>(data.encrypted_payload);
}

/**
 * Sanitizes untrusted input, stamps `updated_at` server-side, encrypts the
 * whole payload, and upserts it via the service-role client. Returns the
 * sanitized + stamped object (the route's 204 response has no body, but
 * the return value lets callers/tests assert what was actually written).
 */
export async function saveApplicationProfile(
  admin: SupabaseClient<Database>,
  userId: string,
  input: unknown
): Promise<ApplicationProfile> {
  const sanitized = sanitizeApplicationProfile(input);
  const updatedAt = new Date().toISOString();
  const stamped: ApplicationProfile = { ...sanitized, updated_at: updatedAt };

  const { error } = await admin.from("application_profiles").upsert({
    user_id: userId,
    encrypted_payload: encryptJson(stamped),
    updated_at: updatedAt,
  });
  if (error) throw error;

  return stamped;
}
