import { describe, expect, it } from "vitest";
import { DISCLOSURE_COPY } from "./disclosureCopy";

describe("DISCLOSURE_COPY", () => {
  it("is a non-empty string", () => {
    expect(typeof DISCLOSURE_COPY).toBe("string");
    expect(DISCLOSURE_COPY.trim().length).toBeGreaterThan(0);
  });

  it("names no one — stays generic 'the operator' copy", () => {
    // scripts/scrub_gate.sh separately scans the whole tree (including this
    // file's own DISCLOSURE_COPY value) for real operator-identifying
    // tokens — this test only pins the neutral phrasing, it must never spell
    // out the forbidden list itself.
    expect(DISCLOSURE_COPY).toMatch(/the operator/i);
    expect(DISCLOSURE_COPY.split(/\s+/).length).toBeLessThan(30);
  });
});
