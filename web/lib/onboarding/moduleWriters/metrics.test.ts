import { describe, expect, it } from "vitest";
import { applyMetricsToDoc, splitMetricClaims, type MetricClaim, type MetricMark } from "./metrics";

const claims: MetricClaim[] = [
  { id: "c1", text: "Cut p95 latency 40%", source: "cv", has_number: true },
  { id: "c2", text: "Led a team of 8 engineers", source: "cv", has_number: true },
  { id: "c3", text: "Shipped the onboarding rewrite", source: "range", has_number: false },
  { id: "c4", text: "Grew MRR to $2M", source: "anchor", has_number: true },
];

describe("splitMetricClaims", () => {
  it("buckets confident:true marks into confirmed", () => {
    const marks: MetricMark[] = [
      { id: "c1", confident: true },
      { id: "c2", confident: false },
      { id: "c3", confident: true },
      { id: "c4", confident: false },
    ];
    const { confirmed, neverUse } = splitMetricClaims(claims, marks);
    expect(confirmed.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(neverUse.map((c) => c.id)).toEqual(["c2", "c4"]);
  });

  it("treats a claim with no matching mark as never-use (defensive default)", () => {
    const marks: MetricMark[] = [{ id: "c1", confident: true }];
    const { confirmed, neverUse } = splitMetricClaims(claims, marks);
    expect(confirmed.map((c) => c.id)).toEqual(["c1"]);
    expect(neverUse.map((c) => c.id)).toEqual(["c2", "c3", "c4"]);
  });

  it("returns empty buckets for empty input", () => {
    expect(splitMetricClaims([], [])).toEqual({ confirmed: [], neverUse: [] });
  });
});

describe("applyMetricsToDoc", () => {
  const marks: MetricMark[] = [
    { id: "c1", confident: true },
    { id: "c2", confident: false },
    { id: "c3", confident: true },
    { id: "c4", confident: false },
  ];

  it("is pure: does not mutate the input doc", () => {
    const doc = { "article-digest.md": "" };
    const before = { ...doc };
    applyMetricsToDoc(doc, claims, marks);
    expect(doc).toEqual(before);
  });

  it("preserves other doc keys untouched", () => {
    const doc = { "article-digest.md": "old", "cv.md": "unchanged" };
    const result = applyMetricsToDoc(doc, claims, marks);
    expect(result["cv.md"]).toBe("unchanged");
  });

  it("renders both headings, locking in the validator's at-least-one-heading expectation", () => {
    const result = applyMetricsToDoc({}, claims, marks);
    const text = result["article-digest.md"];
    expect(/^## /m.test(text)).toBe(true);
    expect(text).toContain("## Confirmed metrics");
    expect(text).toContain("## Never use");
  });

  it("renders confirmed claims with their source annotation under Confirmed metrics", () => {
    const result = applyMetricsToDoc({}, claims, marks);
    const text = result["article-digest.md"];
    expect(text).toContain("- Cut p95 latency 40% (from cv)");
    expect(text).toContain("- Shipped the onboarding rewrite (from range)");
  });

  it("renders unconfirmed claims under Never use", () => {
    const result = applyMetricsToDoc({}, claims, marks);
    const text = result["article-digest.md"];
    expect(text).toContain("- Led a team of 8 engineers (from cv)");
    expect(text).toContain("- Grew MRR to $2M (from anchor)");
  });

  it("renders the empty-bucket fallback lines when everything is on one side", () => {
    const allConfident: MetricMark[] = claims.map((c) => ({ id: c.id, confident: true }));
    const result = applyMetricsToDoc({}, claims, allConfident);
    const text = result["article-digest.md"];
    expect(text).toContain("- none held back");
    expect(text).not.toContain("- none confirmed yet");
  });

  it("renders both fallback lines for empty claims", () => {
    const result = applyMetricsToDoc({}, [], []);
    const text = result["article-digest.md"];
    expect(text).toContain("- none confirmed yet");
    expect(text).toContain("- none held back");
  });
});
