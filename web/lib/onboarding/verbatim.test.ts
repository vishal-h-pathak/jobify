import { describe, expect, it } from "vitest";
import { filterVerbatim, isVerbatimSubstring } from "./verbatim";

describe("isVerbatimSubstring", () => {
  it("is true for an exact substring match", () => {
    expect(isVerbatimSubstring("quick brown", "the quick brown fox")).toBe(true);
  });

  it("is false when the needle is not present", () => {
    expect(isVerbatimSubstring("slow brown", "the quick brown fox")).toBe(false);
  });

  it("trims leading/trailing whitespace off the needle before checking", () => {
    expect(isVerbatimSubstring("  quick brown  ", "the quick brown fox")).toBe(true);
  });

  it("trims leading/trailing whitespace off the haystack before checking", () => {
    expect(isVerbatimSubstring("fox", "  the quick brown fox  ")).toBe(true);
  });

  it("is case-sensitive — no case-insensitive fallback", () => {
    expect(isVerbatimSubstring("Quick Brown", "the quick brown fox")).toBe(false);
  });

  it("is false for an empty needle", () => {
    expect(isVerbatimSubstring("", "the quick brown fox")).toBe(false);
  });

  it("is false for a whitespace-only needle", () => {
    expect(isVerbatimSubstring("   ", "the quick brown fox")).toBe(false);
  });

  it("is false for an empty needle even against an empty haystack", () => {
    expect(isVerbatimSubstring("", "")).toBe(false);
  });

  it("does not fuzzy/normalize — internal whitespace differences fail", () => {
    expect(isVerbatimSubstring("quick  brown", "the quick brown fox")).toBe(false);
  });
});

describe("filterVerbatim", () => {
  const haystack = "I shipped the migration and cut latency in half for the team.";

  it("keeps only items whose text verifies as a verbatim substring", () => {
    const items = [
      { id: "a", text: "shipped the migration" },
      { id: "b", text: "invented a fact" },
      { id: "c", text: "cut latency in half" },
    ];
    const result = filterVerbatim(items, (item) => item.text, haystack);
    expect(result.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("preserves original order among the surviving items", () => {
    const items = [
      { id: "1", text: "cut latency in half" },
      { id: "2", text: "not present anywhere" },
      { id: "3", text: "shipped the migration" },
      { id: "4", text: "the team" },
    ];
    const result = filterVerbatim(items, (item) => item.text, haystack);
    expect(result.map((r) => r.id)).toEqual(["1", "3", "4"]);
  });

  it("drops everything (returns an empty array) when nothing verifies, without throwing", () => {
    const items = [{ id: "a", text: "fabricated claim" }];
    expect(() => filterVerbatim(items, (item) => item.text, haystack)).not.toThrow();
    expect(filterVerbatim(items, (item) => item.text, haystack)).toEqual([]);
  });

  it("returns an empty array for an empty input list", () => {
    expect(filterVerbatim([], (item: { text: string }) => item.text, haystack)).toEqual([]);
  });
});
