import { describe, expect, it } from "vitest";
import { deriveWelcomeBack, isStale } from "./welcomeBack";
import type { ModulesState } from "./moduleRegistry";

const NOW = new Date("2026-07-19T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

describe("isStale", () => {
  it("is false right at the threshold boundary (not strictly over 30 min)", () => {
    expect(isStale(minutesAgo(30), NOW)).toBe(false);
  });

  it("is false for a session updated 10 minutes ago", () => {
    expect(isStale(minutesAgo(10), NOW)).toBe(false);
  });

  it("is true for a session updated 31 minutes ago", () => {
    expect(isStale(minutesAgo(31), NOW)).toBe(true);
  });

  it("is true for a session updated a day ago", () => {
    expect(isStale(minutesAgo(60 * 24), NOW)).toBe(true);
  });
});

describe("deriveWelcomeBack", () => {
  it("returns null when updatedAt is missing (never touched the session)", () => {
    expect(deriveWelcomeBack({}, "anchor", null, NOW)).toBeNull();
  });

  it("returns null when the session was touched recently", () => {
    expect(deriveWelcomeBack({}, "anchor", minutesAgo(5), NOW)).toBeNull();
  });

  it("returns the next module's label when stale and a module remains", () => {
    const modules: ModulesState = {
      anchor: { completed_at: minutesAgo(60), receipt: "Engineer · Acme" },
    };

    expect(deriveWelcomeBack(modules, "anchor", minutesAgo(60), NOW)).toEqual({
      moduleLabel: "your reactions",
    });
  });

  it("returns null once every module is already complete, even when stale", () => {
    const allDone: ModulesState = {
      anchor: { completed_at: minutesAgo(60), receipt: "r" },
      reactions: { completed_at: minutesAgo(60), receipt: "r" },
      values: { completed_at: minutesAgo(60), receipt: "r" },
      dealbreakers: { completed_at: minutesAgo(60), receipt: "r" },
      energy: { completed_at: minutesAgo(60), receipt: "r" },
      environment: { completed_at: minutesAgo(60), receipt: "r" },
      trajectory: { completed_at: minutesAgo(60), receipt: "r" },
      voice: { completed_at: minutesAgo(60), receipt: "r" },
      metrics: { completed_at: minutesAgo(60), receipt: "r" },
      mirror: { completed_at: minutesAgo(60), receipt: "r" },
    };

    expect(deriveWelcomeBack(allDone, "done", minutesAgo(60), NOW)).toBeNull();
  });
});
