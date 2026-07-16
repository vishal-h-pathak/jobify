import { describe, expect, it } from "vitest";
import {
  applyReactionsToDoc,
  hasReachedReactionThreshold,
  reactionsReceipt,
  sampleReactionPostings,
  tokenOverlapScore,
  type CandidatePosting,
  type ReactionEntry,
} from "./reactions";

describe("tokenOverlapScore", () => {
  it("scores identical titles as 1", () => {
    expect(tokenOverlapScore("Senior Backend Engineer", "Senior Backend Engineer")).toBe(1);
  });

  it("scores completely unrelated titles as 0", () => {
    expect(tokenOverlapScore("Senior Backend Engineer", "Retail Store Manager")).toBe(0);
  });

  it("scores partial overlap between 0 and 1", () => {
    const score = tokenOverlapScore("Senior Backend Engineer", "Backend Engineer II");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is case-insensitive", () => {
    expect(tokenOverlapScore("Backend Engineer", "BACKEND ENGINEER")).toBe(1);
  });

  it("treats an empty title as zero overlap", () => {
    expect(tokenOverlapScore("", "Backend Engineer")).toBe(0);
  });
});

function posting(id: string, title: string, lastSeenAt: string): CandidatePosting {
  return { id, title, company: "Acme", location: "Remote", last_seen_at: lastSeenAt };
}

describe("sampleReactionPostings", () => {
  it("ranks by title-overlap against the anchor, most similar first", () => {
    const candidates = [
      posting("p1", "Retail Store Manager", "2026-07-10T00:00:00Z"),
      posting("p2", "Senior Backend Engineer", "2026-07-09T00:00:00Z"),
      posting("p3", "Backend Engineer II", "2026-07-08T00:00:00Z"),
    ];
    const result = sampleReactionPostings({
      anchorTitle: "Senior Backend Engineer",
      candidates,
      reactedPostingIds: new Set(),
      count: 3,
    });
    expect(result.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
  });

  it("excludes already-reacted postings", () => {
    const candidates = [posting("p1", "Backend Engineer", "2026-07-10T00:00:00Z"), posting("p2", "Backend Engineer", "2026-07-09T00:00:00Z")];
    const result = sampleReactionPostings({
      anchorTitle: "Backend Engineer",
      candidates,
      reactedPostingIds: new Set(["p1"]),
    });
    expect(result.map((p) => p.id)).toEqual(["p2"]);
  });

  it("pads with most-recent postings when the overlap pool is thin", () => {
    const candidates = [
      posting("match", "Senior Backend Engineer", "2026-07-01T00:00:00Z"),
      posting("recent-1", "Retail Store Manager", "2026-07-10T00:00:00Z"),
      posting("recent-2", "Warehouse Associate", "2026-07-09T00:00:00Z"),
    ];
    const result = sampleReactionPostings({
      anchorTitle: "Senior Backend Engineer",
      candidates,
      reactedPostingIds: new Set(),
      count: 3,
    });
    // the one real match still ranks first; the unrelated postings pad the
    // rest of the sample, most-recently-seen first
    expect(result.map((p) => p.id)).toEqual(["match", "recent-1", "recent-2"]);
  });

  it("falls back to pure recency ordering with no anchor title", () => {
    const candidates = [posting("older", "A", "2026-07-01T00:00:00Z"), posting("newer", "B", "2026-07-10T00:00:00Z")];
    const result = sampleReactionPostings({ candidates, reactedPostingIds: new Set() });
    expect(result.map((p) => p.id)).toEqual(["newer", "older"]);
  });

  it("returns fewer than count when the whole pool is smaller than the target", () => {
    const candidates = [posting("only", "Backend Engineer", "2026-07-01T00:00:00Z")];
    const result = sampleReactionPostings({ candidates, reactedPostingIds: new Set(), count: 8 });
    expect(result).toHaveLength(1);
  });
});

describe("hasReachedReactionThreshold", () => {
  const react = (n: number): ReactionEntry[] =>
    Array.from({ length: n }, (_, i) => ({ posting_id: `p${i}`, title: "t", company: null, reaction: "interested" as const }));

  it("is false below 6", () => {
    expect(hasReachedReactionThreshold(react(5))).toBe(false);
  });

  it("is true at exactly 6", () => {
    expect(hasReachedReactionThreshold(react(6))).toBe(true);
  });

  it("stays true above 6 (changed minds don't un-complete the module)", () => {
    expect(hasReachedReactionThreshold(react(8))).toBe(true);
  });
});

describe("reactionsReceipt", () => {
  it("reports the current count in a '<n> reactions' style", () => {
    expect(
      reactionsReceipt([{ posting_id: "p1", title: "t", company: null, reaction: "interested" }])
    ).toBe("1 reactions");
  });
});

describe("applyReactionsToDoc", () => {
  const reactions: ReactionEntry[] = [
    { posting_id: "p1", title: "Backend Engineer", company: "Acme", reaction: "interested", note: "great mission" },
    { posting_id: "p2", title: "Sales Manager", company: "Widgets Inc", reaction: "not_interested" },
  ];

  it("is pure: does not mutate the input doc", () => {
    const doc = { "thesis.md": "" };
    const before = { ...doc };
    applyReactionsToDoc(doc, reactions);
    expect(doc).toEqual(before);
  });

  it("renders likes and dislikes with notes into thesis.md", () => {
    const result = applyReactionsToDoc({ "thesis.md": "" }, reactions);
    expect(result["thesis.md"]).toContain("## Calibration — real postings reacted to");
    expect(result["thesis.md"]).toContain("Backend Engineer @ Acme — great mission");
    expect(result["thesis.md"]).toContain("Sales Manager @ Widgets Inc");
    // "not interested" bucket has no note attached
    expect(result["thesis.md"]).not.toMatch(/Sales Manager @ Widgets Inc —/);
  });

  it("re-submission replaces the section instead of duplicating it", () => {
    let doc: Record<string, string> = { "thesis.md": "" };
    doc = applyReactionsToDoc(doc, reactions.slice(0, 1));
    doc = applyReactionsToDoc(doc, reactions);
    expect(doc["thesis.md"].match(/## Calibration/g)).toHaveLength(1);
    expect(doc["thesis.md"]).toContain("Sales Manager");
  });
});
