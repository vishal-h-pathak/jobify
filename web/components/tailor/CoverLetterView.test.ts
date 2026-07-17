import { describe, expect, it } from "vitest";
import { orderCoverLetterUnits } from "./CoverLetterView";
import type { ClaimUnit } from "./types";

function cl(id: string, kind: ClaimUnit["kind"] = "cl_sentence"): ClaimUnit {
  return { id, surface: "cover_letter", kind, text: id, status: "verified" };
}

describe("orderCoverLetterUnits", () => {
  it("orders sentence units by their numeric suffix, not array order", () => {
    const units = [cl("cl.s2"), cl("cl.s0"), cl("cl.s1")];
    expect(orderCoverLetterUnits(units).map((u) => u.id)).toEqual(["cl.s0", "cl.s1", "cl.s2"]);
  });

  it("includes voice-kind sentences alongside cl_sentence ones", () => {
    const units = [cl("cl.s0", "cl_sentence"), cl("cl.s1", "voice")];
    expect(orderCoverLetterUnits(units).map((u) => u.id)).toEqual(["cl.s0", "cl.s1"]);
  });

  it("excludes resume-surface units even if one somehow has a cl.s-shaped id", () => {
    const resumeUnit: ClaimUnit = { id: "cl.s0", surface: "resume", kind: "bullet", text: "x", status: "verified" };
    expect(orderCoverLetterUnits([resumeUnit])).toEqual([]);
  });

  it("handles double-digit sentence indices numerically, not lexically (s10 after s2)", () => {
    const units = [cl("cl.s10"), cl("cl.s2")];
    expect(orderCoverLetterUnits(units).map((u) => u.id)).toEqual(["cl.s2", "cl.s10"]);
  });
});
