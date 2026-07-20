import { describe, expect, it } from "vitest";
import { aggregateHuntFeedOverview } from "./huntFeedOverview";

describe("aggregateHuntFeedOverview", () => {
  it("counts each user's matches by funnel status", () => {
    const byUser = aggregateHuntFeedOverview([
      { user_id: "u1", status: "rejected_title", location_tier: null },
      { user_id: "u1", status: "rejected_title", location_tier: null },
      { user_id: "u1", status: "surfaced", location_tier: 1 },
      { user_id: "u2", status: "surfaced", location_tier: 2 },
    ]);
    expect(byUser.get("u1")?.byStatus).toEqual({
      rejected_title: 2,
      rejected_rubric: 0,
      rejected_rerank: 0,
      rejected_llm: 0,
      surfaced: 1,
    });
    expect(byUser.get("u2")?.byStatus.surfaced).toBe(1);
  });

  it("buckets surfaced matches' location_tier, treating null as unknown", () => {
    const byUser = aggregateHuntFeedOverview([
      { user_id: "u1", status: "surfaced", location_tier: 1 },
      { user_id: "u1", status: "surfaced", location_tier: 1 },
      { user_id: "u1", status: "surfaced", location_tier: 3 },
      { user_id: "u1", status: "surfaced", location_tier: null },
    ]);
    expect(byUser.get("u1")?.surfacedLocationTiers).toEqual({ tier1: 2, tier2: 0, tier3: 1, unknown: 1 });
  });

  it("never counts a rejected row's location_tier — only surfaced rows carry a meaningful tier", () => {
    const byUser = aggregateHuntFeedOverview([{ user_id: "u1", status: "rejected_llm", location_tier: 2 }]);
    expect(byUser.get("u1")?.surfacedLocationTiers).toEqual({ tier1: 0, tier2: 0, tier3: 0, unknown: 0 });
  });

  it("returns an empty map for no rows", () => {
    expect(aggregateHuntFeedOverview([]).size).toBe(0);
  });
});
