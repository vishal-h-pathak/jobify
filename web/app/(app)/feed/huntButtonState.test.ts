import { describe, expect, it } from "vitest";
import { deriveHuntButtonState, formatCooldownRemaining, formatStartedAt } from "./huntButtonState";

const USER_ID = "11111111-2222-3333-4444-555555555555";
const NOW = new Date("2026-07-21T18:00:00.000Z");

describe("deriveHuntButtonState", () => {
  it("is ready when the user has never requested a hunt", () => {
    const state = deriveHuntButtonState({ last_hunt_requested_at: null }, [], USER_ID, 6, NOW);
    expect(state).toEqual({ kind: "ready" });
  });

  it("is in_progress when requested recently and no cycle has finished since", () => {
    const requestedAt = "2026-07-21T17:50:00.000Z"; // 10 min ago
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, [], USER_ID, 6, NOW);
    expect(state).toEqual({ kind: "in_progress", startedAt: requestedAt });
  });

  it("is NOT in_progress once a cycle has finished after the request, even within the 30-minute window", () => {
    const requestedAt = "2026-07-21T17:50:00.000Z";
    const cycles = [
      { started_at: "2026-07-21T17:51:00.000Z", finished_at: "2026-07-21T17:53:00.000Z", counters: {} },
    ];
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, cycles, USER_ID, 6, NOW);
    expect(state.kind).not.toBe("in_progress");
  });

  it("falls out of in_progress after the 30-minute window even with no finished cycle (stuck/lost dispatch)", () => {
    const requestedAt = "2026-07-21T17:00:00.000Z"; // 60 min ago
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, [], USER_ID, 6, NOW);
    expect(state.kind).not.toBe("in_progress");
  });

  it("is error when the newest cycle after the request carries a first_error prefixed with this user's id", () => {
    const requestedAt = "2026-07-21T17:00:00.000Z";
    const cycles = [
      {
        started_at: "2026-07-21T17:01:00.000Z",
        finished_at: "2026-07-21T17:03:00.000Z",
        counters: { first_error: `${USER_ID.slice(0, 8)}: Traceback ... boom` },
      },
    ];
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, cycles, USER_ID, 6, NOW);
    expect(state).toEqual({ kind: "error" });
  });

  it("is NOT error when first_error is prefixed with a different user's id (best-effort match, not a false positive)", () => {
    const requestedAt = "2026-07-21T17:00:00.000Z";
    const cycles = [
      {
        started_at: "2026-07-21T17:01:00.000Z",
        finished_at: "2026-07-21T17:03:00.000Z",
        counters: { first_error: "99999999: someone else's traceback" },
      },
    ];
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, cycles, USER_ID, 6, NOW);
    expect(state.kind).not.toBe("error");
  });

  it("picks the newest cycle after the request when several exist, ignoring an older one's error", () => {
    const requestedAt = "2026-07-21T17:00:00.000Z";
    const cycles = [
      {
        started_at: "2026-07-21T17:01:00.000Z",
        finished_at: "2026-07-21T17:02:00.000Z",
        counters: { first_error: `${USER_ID.slice(0, 8)}: old failure` },
      },
      {
        started_at: "2026-07-21T17:05:00.000Z",
        finished_at: "2026-07-21T17:07:00.000Z",
        counters: {},
      },
    ];
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, cycles, USER_ID, 6, NOW);
    expect(state.kind).not.toBe("error");
  });

  it("is cooldown when the last request is outside the in-progress window but within HUNT_COOLDOWN_HOURS", () => {
    const requestedAt = "2026-07-21T16:00:00.000Z"; // 2h ago
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, [], USER_ID, 6, NOW);
    expect(state).toEqual({ kind: "cooldown", availableAt: "2026-07-21T22:00:00.000Z" });
  });

  it("is ready once the cooldown window has fully elapsed", () => {
    const requestedAt = "2026-07-21T10:00:00.000Z"; // 8h ago, 6h cooldown
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, [], USER_ID, 6, NOW);
    expect(state).toEqual({ kind: "ready" });
  });

  it("ignores cycles that started before the request (unrelated earlier cron runs)", () => {
    const requestedAt = "2026-07-21T17:45:00.000Z"; // 15 min ago -> still in the in_progress window
    const cycles = [
      {
        started_at: "2026-07-21T10:00:00.000Z",
        finished_at: "2026-07-21T10:05:00.000Z",
        counters: { first_error: `${USER_ID.slice(0, 8)}: unrelated old error` },
      },
    ];
    // That cycle predates the request entirely -> irrelevant, still in_progress
    const state = deriveHuntButtonState({ last_hunt_requested_at: requestedAt }, cycles, USER_ID, 6, NOW);
    expect(state.kind).toBe("in_progress");
  });
});

describe("formatStartedAt", () => {
  it("falls back to an empty string for an unparseable timestamp", () => {
    expect(formatStartedAt("not-a-date")).toBe("");
  });

  it("formats a valid ISO timestamp as a time string", () => {
    expect(formatStartedAt("2026-07-21T17:50:00.000Z")).not.toBe("");
  });
});

describe("formatCooldownRemaining", () => {
  it("rounds up to the next whole hour", () => {
    expect(formatCooldownRemaining("2026-07-21T20:01:00.000Z", NOW)).toBe("~3h");
  });

  it("floors at ~1h rather than ~0h when the window is nearly over", () => {
    expect(formatCooldownRemaining("2026-07-21T18:05:00.000Z", NOW)).toBe("~1h");
  });
});
