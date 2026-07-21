import { describe, expect, it } from "vitest";
import { initialMessageFrom, initialStatusFrom } from "./RunHuntButton";

describe("initialStatusFrom — maps deriveHuntButtonState's server truth onto the button's own status machine", () => {
  it("undefined (no server state, e.g. admin's own hunt page) is idle", () => {
    expect(initialStatusFrom(undefined)).toBe("idle");
  });

  it("in_progress renders as the non-clickable running state", () => {
    expect(initialStatusFrom({ kind: "in_progress", startedAt: "2026-07-21T17:50:00.000Z" })).toBe("running");
  });

  it("cooldown renders as the disabled cooldown state", () => {
    expect(initialStatusFrom({ kind: "cooldown", availableAt: "2026-07-21T22:00:00.000Z" })).toBe("cooldown");
  });

  it("error renders as the clickable error/retry state", () => {
    expect(initialStatusFrom({ kind: "error" })).toBe("error");
  });

  it("ready renders as idle", () => {
    expect(initialStatusFrom({ kind: "ready" })).toBe("idle");
  });
});

describe("initialMessageFrom", () => {
  it("cooldown carries a relative 'available in ~Xh' message", () => {
    const now = new Date("2026-07-21T18:00:00.000Z");
    const message = initialMessageFrom({ kind: "cooldown", availableAt: "2026-07-21T22:00:00.000Z" }, now);
    expect(message).toBe("Next hunt available in ~4h.");
  });

  it("error carries a retry-oriented message", () => {
    expect(initialMessageFrom({ kind: "error" })).toBe("Last hunt hit an error — try again.");
  });

  it("ready/in_progress/undefined carry no message (running has its own started-at copy instead)", () => {
    expect(initialMessageFrom({ kind: "ready" })).toBe("");
    expect(initialMessageFrom({ kind: "in_progress", startedAt: "2026-07-21T17:50:00.000Z" })).toBe("");
    expect(initialMessageFrom(undefined)).toBe("");
  });
});
