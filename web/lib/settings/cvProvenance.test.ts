import { describe, expect, it } from "vitest";
import { deriveCvProvenance } from "./cvProvenance";

describe("deriveCvProvenance", () => {
  it("returns 'none' when doc is null/undefined", () => {
    expect(deriveCvProvenance(null)).toBe("none");
    expect(deriveCvProvenance(undefined)).toBe("none");
  });

  it("returns 'none' when cv.md is missing or blank", () => {
    expect(deriveCvProvenance({})).toBe("none");
    expect(deriveCvProvenance({ "cv.md": "   \n" })).toBe("none");
  });

  it("returns 'interview' when cv.md carries the synthesized-CV provenance marker", () => {
    const doc = { "cv.md": "# CV — assembled from onboarding interview (no resume provided)\n\n## Background\n" };
    expect(deriveCvProvenance(doc)).toBe("interview");
  });

  it("returns 'resume' for any other non-empty cv.md content", () => {
    const doc = { "cv.md": "## Senior Backend Engineer — Acme Corp\n- Shipped things\n" };
    expect(deriveCvProvenance(doc)).toBe("resume");
  });
});
