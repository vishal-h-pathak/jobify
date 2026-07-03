import yaml from "js-yaml";

/**
 * TS port of `onboarding/validate_profile.py`'s REQUIRED-level (ERROR)
 * checks only — the "jsonschema not installed" fallback path in that
 * script: presence of top-level required keys, and one level deep into
 * required keys of nested object properties. This gives immediate UX
 * feedback in the onboarding chat; the authoritative Python validator
 * still runs at materialization time (H2/H4) and overwrites
 * `profiles.validation_status` with its own verdict.
 *
 * Deliberately NOT a full JSON Schema port: no minItems, no enum, no type
 * checks beyond "is this a plain object" — matching the Python fallback's
 * shallow required-key walk exactly (see validate_profile.py
 * `_validate_against_schema`'s ImportError branch).
 */

export interface ValidationResult {
  status: "valid" | "invalid";
  errors: string[];
  warnings: string[];
}

const APPLICATION_DEFAULTS_REQUIRED = [
  "work_authorization",
  "visa_sponsorship_needed",
  "earliest_start_date",
  "relocation_willingness",
  "in_person_willingness",
  "ai_policy_ack",
  "previous_interview_with_company",
] as const;

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

/**
 * `doc` is the same shape as the `profiles.doc` JSONB column: a flat map
 * of the eight profile filenames to their raw file-text contents (see
 * `jobify/profile_loader.py::DOC_FILENAMES`).
 */
export function validateProfileDoc(doc: Record<string, string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── profile.yml (hard-required structure) ────────────────────────────
  const profileText = doc["profile.yml"] ?? "";
  const profile = parseYaml(profileText);
  if (!isPlainObject(profile) || Object.keys(profile).length === 0) {
    errors.push("profile.yml: missing or not a mapping (REQUIRED file)");
  } else {
    if (!("identity" in profile)) {
      errors.push("profile.yml: missing required key(s): identity");
    } else if (isPlainObject(profile.identity)) {
      const missing = ["name", "email"].filter((k) => !(k in (profile.identity as Record<string, unknown>)));
      if (missing.length) {
        errors.push(`profile.yml: 'identity' missing required key(s): ${missing.join(", ")}`);
      }
    }

    if (!("application_defaults" in profile)) {
      errors.push("profile.yml: missing required key(s): application_defaults");
    } else if (isPlainObject(profile.application_defaults)) {
      const defaults = profile.application_defaults as Record<string, unknown>;
      const missing = APPLICATION_DEFAULTS_REQUIRED.filter((k) => !(k in defaults));
      if (missing.length) {
        errors.push(`profile.yml: 'application_defaults' missing required key(s): ${missing.join(", ")}`);
      }
      const piv = defaults.previous_interview_with_company;
      if (piv !== undefined && piv !== null && !isPlainObject(piv)) {
        errors.push(
          "profile.yml: application_defaults.previous_interview_with_company must be a map of company-slug -> bool (may be {})"
        );
      }
    }
  }

  // ── disqualifiers.yml (missing/empty is a WARNING, not an error) ─────
  const disqText = doc["disqualifiers.yml"] ?? "";
  const disq = parseYaml(disqText);
  if (!isPlainObject(disq) || Object.keys(disq).length === 0) {
    warnings.push("disqualifiers.yml: missing/empty (scorer can't floor bad roles)");
  } else {
    const missing = ["hard_disqualifiers", "soft_concerns"].filter((k) => !(k in disq));
    if (missing.length) {
      errors.push(`disqualifiers.yml: missing required key(s): ${missing.join(", ")}`);
    }
  }

  // ── portals.yml (missing/empty is a WARNING, not an error) ────────────
  const portalsText = doc["portals.yml"] ?? "";
  const portals = parseYaml(portalsText);
  if (!isPlainObject(portals) || Object.keys(portals).length === 0) {
    warnings.push("portals.yml: missing/empty (jobify-hunt has no boards to poll)");
  } else {
    const missing = ["greenhouse", "lever", "ashby", "workday", "title_filter"].filter((k) => !(k in portals));
    if (missing.length) {
      errors.push(`portals.yml: missing required key(s): ${missing.join(", ")}`);
    }
    if (isPlainObject(portals.title_filter)) {
      const tf = portals.title_filter as Record<string, unknown>;
      const tfMissing = ["reject_substrings", "prefer_substrings", "seniority_substrings"].filter(
        (k) => !(k in tf)
      );
      if (tfMissing.length) {
        errors.push(`portals.yml: 'title_filter' missing required key(s): ${tfMissing.join(", ")}`);
      }
    }
  }

  // ── voice-profile.md: non-empty but zero '## ' sections is an ERROR ──
  const voiceText = doc["voice-profile.md"] ?? "";
  if (voiceText.trim()) {
    const hasSection = /^##\s+\S/m.test(voiceText);
    if (!hasSection) {
      errors.push(
        "voice-profile.md: no '## ' sections — loader yields an empty sections dict and the tailor loses all voice guidance"
      );
    }
  }

  return {
    status: errors.length === 0 ? "valid" : "invalid",
    errors,
    warnings,
  };
}
