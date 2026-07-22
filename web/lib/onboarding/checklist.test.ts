import { describe, expect, it } from "vitest";
import {
  INTERVIEW_CHECKLIST,
  isFieldPresent,
  isSentinelPlaceholder,
  missingFields,
  isInterviewDone,
  firstMissingIntent,
  fieldsForIntent,
  missingFieldsForIntent,
} from "./checklist";
import type { ExtractedState } from "../profile/buildDoc";

const FULL: ExtractedState = {
  anchor: { current_title: "Staff Engineer", current_company: "Acme" },
  calibration: {
    skills: ["Go"],
    evidence: ["Shipped a thing"],
    range_statement: "Open to adjacent work",
    background_summary: "Backend engineer.",
  },
  resumeResolved: true,
  identity: {
    name: "Alex Quinn",
    email: "alex@example.com",
    location_and_compensation: { base: "Denver, CO", remote_acceptable: true },
  },
  targeting: {
    tiers: [{ key: "tier_1", label: "Backend" }],
    hard_disqualifiers: [],
    soft_concerns: [],
    thesis_summary: "Wants backend roles.",
  },
};

describe("INTERVIEW_CHECKLIST — single ownership (U2 item 6)", () => {
  it("every field is owned by exactly one intent", () => {
    const seen = new Set<string>();
    for (const field of INTERVIEW_CHECKLIST) {
      expect(seen.has(field.extractedPath)).toBe(false);
      seen.add(field.extractedPath);
    }
  });

  it("never includes energy/trajectory/values/dealbreakers fields — those modules own that ground", () => {
    const paths = INTERVIEW_CHECKLIST.map((f) => f.extractedPath);
    for (const forbidden of ["hours_disappear", "kept_putting_off", "direction", "hard_disqualifiers", "choices"]) {
      expect(paths.some((p) => p.includes(forbidden))).toBe(false);
    }
  });

  it("only calibration and resume fields map to a ModuleKey (range/evidence) — identity/targeting map to none, same as the v2 machine", () => {
    for (const field of INTERVIEW_CHECKLIST) {
      if (field.intent === "calibration") expect(field.module).toBe("range");
      else if (field.intent === "resume") expect(field.module).toBe("evidence");
      else expect(field.module).toBeUndefined();
    }
  });
});

describe("isFieldPresent", () => {
  it("treats undefined/null as absent", () => {
    expect(isFieldPresent(undefined)).toBe(false);
    expect(isFieldPresent(null)).toBe(false);
  });

  it("treats whitespace-only strings as absent, non-empty strings as present", () => {
    expect(isFieldPresent("   ")).toBe(false);
    expect(isFieldPresent("")).toBe(false);
    expect(isFieldPresent("hi")).toBe(true);
  });

  it("treats empty arrays as absent, non-empty arrays as present", () => {
    expect(isFieldPresent([])).toBe(false);
    expect(isFieldPresent(["a"])).toBe(true);
  });

  it("treats empty objects as absent, non-empty objects as present", () => {
    expect(isFieldPresent({})).toBe(false);
    expect(isFieldPresent({ base: "Denver" })).toBe(true);
  });

  it("treats a defined boolean/number as present regardless of value (false/0 are real answers)", () => {
    expect(isFieldPresent(false)).toBe(true);
    expect(isFieldPresent(0)).toBe(true);
  });

  describe("Fix C (session 57): hallucinated placeholder values do not satisfy presence", () => {
    it("'<UNKNOWN>' does not satisfy identity_name — the motivating live defect", () => {
      expect(isFieldPresent("<UNKNOWN>")).toBe(false);
    });

    it("rejects every named sentinel, case-insensitively and decoration-insensitively", () => {
      for (const raw of ["unknown", "UNKNOWN", "Unknown", "<UNKNOWN>", "N/A", "n/a", "TBD", "tbd", "Not Provided", "[unknown]"]) {
        expect(isFieldPresent(raw)).toBe(false);
      }
    });

    it("a real value that merely contains a sentinel word as a substring is still present (no over-matching)", () => {
      expect(isFieldPresent("Not Provided Consulting LLC")).toBe(true);
      expect(isFieldPresent("Unknown Pleasures Records")).toBe(true);
    });
  });
});

describe("isSentinelPlaceholder", () => {
  it("matches bracket/angle/brace-decorated and bare forms alike", () => {
    for (const raw of ["<UNKNOWN>", "unknown", "[unknown]", "{unknown}", "  unknown  "]) {
      expect(isSentinelPlaceholder(raw)).toBe(true);
    }
  });

  it("does not match non-sentinel strings or non-strings", () => {
    expect(isSentinelPlaceholder("Alex Quinn")).toBe(false);
    expect(isSentinelPlaceholder(undefined)).toBe(false);
    expect(isSentinelPlaceholder(null)).toBe(false);
    expect(isSentinelPlaceholder(42)).toBe(false);
  });
});

describe("missingFields / isInterviewDone / firstMissingIntent", () => {
  it("a brand-new session (only anchor) is missing everything, starting with calibration", () => {
    const extracted: ExtractedState = { anchor: { current_title: "Staff Engineer", current_company: "Acme" } };
    const missing = missingFields(extracted);
    expect(missing.length).toBe(INTERVIEW_CHECKLIST.length);
    expect(firstMissingIntent(extracted)).toBe("calibration");
    expect(isInterviewDone(extracted)).toBe(false);
  });

  it("is done once every required field in FULL is present", () => {
    expect(missingFields(FULL)).toEqual([]);
    expect(isInterviewDone(FULL)).toBe(true);
    expect(firstMissingIntent(FULL)).toBeNull();
  });

  it("never re-asks a field that's already present (U2 item 4 — extraction-blind questioning)", () => {
    const extracted: ExtractedState = {
      ...FULL,
      targeting: undefined,
    };
    expect(firstMissingIntent(extracted)).toBe("targeting");
    // calibration/resume/identity are all present and must not reappear.
    const missing = missingFields(extracted).map((f) => f.intent);
    expect(missing.every((i) => i === "targeting")).toBe(true);
  });

  it("excludeIntent computes the hypothetical 'next after this one resolves' target", () => {
    const extracted: ExtractedState = { anchor: FULL.anchor };
    expect(firstMissingIntent(extracted)).toBe("calibration");
    expect(firstMissingIntent(extracted, { excludeIntent: "calibration" })).toBe("resume");
  });

  it("excludeIntent on the last remaining intent returns null (nothing left after it)", () => {
    const extracted: ExtractedState = { ...FULL, targeting: undefined };
    expect(firstMissingIntent(extracted, { excludeIntent: "targeting" })).toBeNull();
  });

  it("a partially-filled intent's still-missing fields are reported by missingFieldsForIntent", () => {
    const extracted: ExtractedState = {
      ...FULL,
      identity: { name: "Alex Quinn", email: "alex@example.com" },
    };
    const missing = missingFieldsForIntent("identity", extracted);
    expect(missing.map((f) => f.key)).toEqual(["identity_logistics"]);
  });

  describe("Fix D (session 58): deferred_intents stops blocking done-ness but is not data presence", () => {
    it("a deferred intent's missing required fields no longer block isInterviewDone/firstMissingIntent", () => {
      const extracted: ExtractedState = {
        ...FULL,
        identity: undefined,
        deferred_intents: ["identity"],
      };
      expect(isInterviewDone(extracted)).toBe(true);
      expect(firstMissingIntent(extracted)).toBeNull();
      expect(missingFields(extracted)).toEqual([]);
    });

    it("a deferred intent no longer surfaces as the next thing to ask about, even if other intents remain", () => {
      const extracted: ExtractedState = {
        ...FULL,
        identity: undefined,
        targeting: undefined,
        deferred_intents: ["identity"],
      };
      expect(firstMissingIntent(extracted)).toBe("targeting");
    });

    it("missingFieldsForIntent stays RAW (deferred-blind) — module-completion glue must never see a deferred intent's unanswered fields as resolved", () => {
      const extracted: ExtractedState = { ...FULL, identity: undefined, deferred_intents: ["identity"] };
      const missing = missingFieldsForIntent("identity", extracted);
      expect(missing.map((f) => f.key)).toEqual(["identity_name", "identity_logistics"]);
    });

    it("deferring an intent that was never actually missing is a no-op", () => {
      expect(isInterviewDone({ ...FULL, deferred_intents: ["calibration"] })).toBe(true);
    });
  });
});

describe("fieldsForIntent", () => {
  it("returns every field for a given intent, in checklist order", () => {
    expect(fieldsForIntent("calibration").map((f) => f.key)).toEqual([
      "calibration_skills",
      "calibration_evidence",
      "calibration_range_statement",
      "calibration_background_summary",
    ]);
  });
});
