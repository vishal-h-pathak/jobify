import { describe, expect, it } from "vitest";
import { claimChipLabel, highlightNumbers } from "./SourceChip";
import type { ClaimUnit } from "./types";

function unit(overrides: Partial<ClaimUnit>): ClaimUnit {
  return { id: "r.exp0.b0", surface: "resume", kind: "bullet", status: "verified", ...overrides };
}

describe("claimChipLabel", () => {
  it("a verified bullet with a cv.md source, with a line number", () => {
    expect(
      claimChipLabel(unit({ sources: [{ file: "cv.md", quote: "...", start_line: 41 }] }))
    ).toBe("from your resume, line 41");
  });

  it("a verified unit with a source but no line number", () => {
    expect(claimChipLabel(unit({ sources: [{ file: "cv.md", quote: "..." }] }))).toBe("from your resume");
  });

  it("a voice cover-letter sentence has no source and reads 'your voice'", () => {
    expect(claimChipLabel(unit({ kind: "voice", surface: "cover_letter" }))).toBe("your voice");
  });

  it("a user-edited unit always reads 'yours', even if it still carries old sources", () => {
    expect(
      claimChipLabel(unit({ status: "user_edited", sources: [{ file: "cv.md", quote: "..." }] }))
    ).toBe("yours");
  });

  it("a unit with no sources array falls back to 'unsourced'", () => {
    expect(claimChipLabel(unit({}))).toBe("unsourced");
  });
});

describe("highlightNumbers", () => {
  it("no numbers → the text passes through as one non-metric segment", () => {
    expect(highlightNumbers("just words", [])).toEqual([{ text: "just words", isMetric: false }]);
  });

  it("splits out each number token as its own metric segment", () => {
    expect(
      highlightNumbers("Cut p95 from 2.1s to 380ms on Jetson Orin", [
        { token: "2.1s", basis: "confirmed_metric" },
        { token: "380ms", basis: "confirmed_metric" },
      ])
    ).toEqual([
      { text: "Cut p95 from ", isMetric: false },
      { text: "2.1s", isMetric: true },
      { text: " to ", isMetric: false },
      { text: "380ms", isMetric: true },
      { text: " on Jetson Orin", isMetric: false },
    ]);
  });

  it("escapes regex-special characters in tokens (e.g. a bare $ amount)", () => {
    expect(highlightNumbers("Saved $2.5M annually", [{ token: "$2.5M", basis: "confirmed_metric" }])).toEqual([
      { text: "Saved ", isMetric: false },
      { text: "$2.5M", isMetric: true },
      { text: " annually", isMetric: false },
    ]);
  });
});
