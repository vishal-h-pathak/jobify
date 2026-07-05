import { describe, expect, it } from "vitest";
import { formatCooldownTime, interpretHuntResponse } from "./huntOutcome";

describe("interpretHuntResponse", () => {
  it("maps 200 to running (idle -> busy -> running)", () => {
    expect(interpretHuntResponse(200, { cooldown_until: "2026-07-05T18:00:00.000Z" })).toEqual({
      kind: "running",
    });
  });

  it("maps 429 to cooldown with a formatted next-available-time message", () => {
    const outcome = interpretHuntResponse(429, { error: "cooldown", cooldown_until: "2026-07-05T14:00:00.000Z" });
    expect(outcome.kind).toBe("cooldown");
    expect(outcome).toMatchObject({ kind: "cooldown", message: expect.stringContaining("Next hunt available at") });
  });

  it("maps any other non-2xx status to a generic error, passing the server message through", () => {
    expect(interpretHuntResponse(503, { error: "hunt dispatch is not configured" })).toEqual({
      kind: "error",
      message: "hunt dispatch is not configured",
    });
  });

  it("falls back to a generic error message when the body has none", () => {
    expect(interpretHuntResponse(502, {})).toEqual({ kind: "error", message: "Something went wrong." });
  });
});

describe("formatCooldownTime", () => {
  it("falls back to 'soon' for an unparseable timestamp", () => {
    expect(formatCooldownTime("not-a-date")).toBe("soon");
  });

  it("formats a valid ISO timestamp as a time string", () => {
    expect(formatCooldownTime("2026-07-05T18:00:00.000Z")).not.toBe("soon");
  });
});
