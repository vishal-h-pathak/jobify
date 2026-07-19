import yaml from "js-yaml";
import type { ApplicationProfile, SubmitPacket } from "./types";

// Same narrow parsing helpers as `web/lib/profile/validate.ts`'s
// `isPlainObject`/`parseYaml` — copied locally rather than importing a
// private function out of that file (per the task brief).
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseYaml(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return yaml.load(text);
  } catch {
    return undefined;
  }
}

interface ParsedIdentity {
  name?: string;
  phone?: string;
  location_base?: string;
  linkedin?: string;
  website?: string;
  github?: string;
}

function readIdentityBlock(profileDoc: Record<string, string> | null): ParsedIdentity {
  const profileYaml = profileDoc?.["profile.yml"] ?? "";
  const parsed = parseYaml(profileYaml);
  if (!isPlainObject(parsed)) return {};
  const identity = parsed.identity;
  if (!isPlainObject(identity)) return {};
  const out: ParsedIdentity = {};
  if (typeof identity.name === "string") out.name = identity.name;
  if (typeof identity.phone === "string") out.phone = identity.phone;
  if (typeof identity.location_base === "string") out.location_base = identity.location_base;
  if (typeof identity.linkedin === "string") out.linkedin = identity.linkedin;
  if (typeof identity.website === "string") out.website = identity.website;
  if (typeof identity.github === "string") out.github = identity.github;
  return out;
}

function splitName(name: string | undefined): { first_name: string; last_name: string; full_name: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { first_name: "", last_name: "", full_name: "" };
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { first_name: trimmed, last_name: "", full_name: trimmed };
  }
  return {
    first_name: trimmed.slice(0, spaceIndex),
    last_name: trimmed.slice(spaceIndex + 1),
    full_name: trimmed,
  };
}

/**
 * Contact-field fallback: the decrypted `ApplicationProfile.contact` field
 * wins when present and non-empty, else the matching `profile.yml`
 * `identity.*` field, else `""`. Never invents a placeholder — see Global
 * Constraints, "every absent value is ''".
 */
function contactField(fromProfile: string | undefined, fromDoc: string | undefined): string {
  if (fromProfile !== undefined && fromProfile !== "") return fromProfile;
  return fromDoc ?? "";
}

/**
 * The one canonical identity accessor for the submit packet (Global
 * Constraints, "Identity precedence"). Pure function over already-fetched
 * data — no I/O, no re-parsing of `profile.yml` anywhere else in this
 * plan.
 *
 * Precedence:
 * - `email` = `authEmail`, always — `profile.yml`'s `identity.email` is
 *   never read.
 * - `first_name`/`last_name`/`full_name` — parsed from `profile.yml`'s
 *   `identity.name` only (split on the first space).
 * - `phone`/`location`/`linkedin_url`/`github_url`/`portfolio_url` —
 *   `applicationProfile.contact.*` wins when present and non-empty, else
 *   the matching `profile.yml` `identity.*` field, else `""`.
 */
export function buildIdentity(
  profileDoc: Record<string, string> | null,
  applicationProfile: ApplicationProfile | null,
  authEmail: string
): SubmitPacket["identity"] {
  const docIdentity = readIdentityBlock(profileDoc);
  const contact = applicationProfile?.contact ?? {};
  const { first_name, last_name, full_name } = splitName(docIdentity.name);

  return {
    first_name,
    last_name,
    full_name,
    email: authEmail,
    phone: contactField(contact.phone, docIdentity.phone),
    location: contactField(contact.location, docIdentity.location_base),
    linkedin_url: contactField(contact.linkedin_url, docIdentity.linkedin),
    github_url: contactField(contact.github_url, docIdentity.github),
    portfolio_url: contactField(contact.portfolio_url, docIdentity.website),
  };
}
