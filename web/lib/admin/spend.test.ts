import { describe, expect, it } from "vitest";
import { aggregateSpendOverview } from "./spend";

const NOW = new Date("2026-07-20T12:00:00Z");

describe("aggregateSpendOverview", () => {
  it("sums an all-time total across every row regardless of date", () => {
    const overview = aggregateSpendOverview(
      [
        { user_id: "u1", event: "onboarding_turn", cost_usd: 1.5, created_at: "2026-01-01T00:00:00Z" },
        { user_id: "u1", event: "llm_verdict", cost_usd: 0.25, created_at: "2026-07-20T00:00:00Z" },
      ],
      NOW
    );
    expect(overview.allTimeTotalUsd).toBeCloseTo(1.75);
  });

  it("groups by event (the ledger's own verb/kind values)", () => {
    const overview = aggregateSpendOverview(
      [
        { user_id: "u1", event: "onboarding_turn", cost_usd: 1, created_at: "2026-07-20T00:00:00Z" },
        { user_id: "u2", event: "onboarding_turn", cost_usd: 2, created_at: "2026-07-20T00:00:00Z" },
        { user_id: "u1", event: "mirror", cost_usd: 0.5, created_at: "2026-07-20T00:00:00Z" },
      ],
      NOW
    );
    expect(overview.byEvent).toEqual({ onboarding_turn: 3, mirror: 0.5 });
  });

  it("groups all-time totals by user", () => {
    const overview = aggregateSpendOverview(
      [
        { user_id: "u1", event: "onboarding_turn", cost_usd: 1, created_at: "2026-01-01T00:00:00Z" },
        { user_id: "u1", event: "mirror", cost_usd: 2, created_at: "2026-07-20T00:00:00Z" },
        { user_id: "u2", event: "onboarding_turn", cost_usd: 5, created_at: "2026-07-20T00:00:00Z" },
      ],
      NOW
    );
    expect(overview.byUser).toEqual(
      expect.arrayContaining([
        { userId: "u1", costUsd: 3 },
        { userId: "u2", costUsd: 5 },
      ])
    );
  });

  it("zero-fills the last 14 UTC days including today, oldest first", () => {
    const overview = aggregateSpendOverview([], NOW);
    expect(overview.last14Days).toHaveLength(14);
    expect(overview.last14Days[0].date).toBe("2026-07-07");
    expect(overview.last14Days[13].date).toBe("2026-07-20");
    expect(overview.last14Days.every((d) => d.costUsd === 0)).toBe(true);
  });

  it("buckets a row into its UTC calendar day within the 14-day window", () => {
    const overview = aggregateSpendOverview(
      [{ user_id: "u1", event: "onboarding_turn", cost_usd: 3, created_at: "2026-07-15T23:59:59Z" }],
      NOW
    );
    const day = overview.last14Days.find((d) => d.date === "2026-07-15");
    expect(day?.costUsd).toBe(3);
  });

  it("drops a row outside the 14-day window from the daily table but keeps it in the all-time total", () => {
    const overview = aggregateSpendOverview(
      [{ user_id: "u1", event: "onboarding_turn", cost_usd: 9, created_at: "2026-01-01T00:00:00Z" }],
      NOW
    );
    expect(overview.allTimeTotalUsd).toBe(9);
    expect(overview.last14Days.every((d) => d.costUsd === 0)).toBe(true);
  });
});
