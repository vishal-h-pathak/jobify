import { describe, expect, it } from "vitest";
import { setThesisIntroFromMirror } from "./mirror";

describe("setThesisIntroFromMirror", () => {
  it("replaces a simple intro-only thesis.md", () => {
    const before = "# Hunting thesis\n\nOld intro paragraph one.\n\nOld intro paragraph two.\n";
    const result = setThesisIntroFromMirror(before, ["New intro paragraph one.", "New intro paragraph two."]);
    expect(result).toBe(
      "# Hunting thesis\n\nNew intro paragraph one.\n\nNew intro paragraph two.\n"
    );
  });

  it("returns the fresh-intro fallback when there is no '## ' heading at all", () => {
    const result = setThesisIntroFromMirror("", ["Intro one.", "Intro two."]);
    expect(result).toBe("# Hunting thesis\n\nIntro one.\n\nIntro two.\n");
  });

  it("returns the fresh-intro fallback for a malformed thesis.md with prose but no sections", () => {
    const before = "# Hunting thesis\n\nJust some prose, no sections at all.\n";
    const result = setThesisIntroFromMirror(before, ["Intro one.", "Intro two."]);
    expect(result).toBe("# Hunting thesis\n\nIntro one.\n\nIntro two.\n");
  });

  // Regression test: this function exists specifically to replace the intro
  // without disturbing any existing `## ` section. A realistic multi-section
  // thesis.md fixture must survive byte-for-byte past the intro swap.
  it("REGRESSION: preserves 2+ existing '## ' sections byte-for-byte while only replacing the intro", () => {
    const hardConstraintsSection =
      "## Hard constraints\n\n- No return-to-office mandates beyond 2 days/week\n- Base comp floor: $170k\n- No crypto/gambling domains\n";
    const whatMattersSection =
      "## What matters (chosen under trade-off)\n\n- Mission-driven work\n- Variable 50 + equity upside\n- Deep specialist\n";
    const tail = `${hardConstraintsSection}\n${whatMattersSection}`;

    const before = `# Hunting thesis\n\nStale intro paragraph one, about to be replaced.\n\nStale intro paragraph two, also about to be replaced.\n\n${tail}`;

    const newParagraphs: [string, string] = [
      "This candidate prioritizes mission-driven, high-agency roles over brand prestige.",
      "They will walk from anything requiring daily in-office presence or sub-market comp.",
    ];

    const result = setThesisIntroFromMirror(before, newParagraphs);

    // New intro landed.
    expect(result).toContain(newParagraphs[0]);
    expect(result).toContain(newParagraphs[1]);
    // Stale intro is gone.
    expect(result).not.toContain("Stale intro paragraph one");
    expect(result).not.toContain("Stale intro paragraph two");

    // The sections tail survives byte-for-byte, not just "some content".
    expect(result.endsWith(tail)).toBe(true);
    expect(result).toContain(hardConstraintsSection);
    expect(result).toContain(whatMattersSection);

    // Exact full-string reconstruction.
    expect(result).toBe(
      `# Hunting thesis\n\n${newParagraphs.join("\n\n")}\n\n${tail}`
    );

    // Sanity: still exactly one of each heading (no duplication/mangling).
    expect(result.match(/^## Hard constraints$/m)).toHaveLength(1);
    expect(result.match(/^## What matters \(chosen under trade-off\)$/m)).toHaveLength(1);
  });

  it("preserves a tail that starts at index 0 (markdown with no leading '# ' title / intro)", () => {
    const tail = "## Hard constraints\n\n- No crypto/gambling domains\n";
    const before = tail;
    const result = setThesisIntroFromMirror(before, ["Intro one.", "Intro two."]);
    expect(result).toBe(`# Hunting thesis\n\nIntro one.\n\nIntro two.\n\n${tail}`);
  });
});
