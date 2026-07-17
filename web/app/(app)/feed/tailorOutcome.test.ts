import { describe, expect, it } from "vitest";
import { interpretTailorResponse } from "./tailorOutcome";

describe("interpretTailorResponse", () => {
  it("2xx returns started with the run id", () => {
    expect(interpretTailorResponse(200, { ok: true, run_id: "run-1" })).toEqual({
      kind: "started",
      runId: "run-1",
    });
  });

  it("429 daily_limit returns a count-aware message", () => {
    expect(interpretTailorResponse(429, { error: "daily_limit", count: 5 })).toEqual({
      kind: "daily_limit",
      message: "You've used 5 tailors today — try again tomorrow.",
    });
  });

  it("429 daily_limit singularizes count 1", () => {
    expect(interpretTailorResponse(429, { error: "daily_limit", count: 1 })).toEqual({
      kind: "daily_limit",
      message: "You've used 1 tailor today — try again tomorrow.",
    });
  });

  it("429 cooldown returns a qualitative message, never a fabricated time", () => {
    expect(interpretTailorResponse(429, { error: "cooldown" })).toEqual({
      kind: "cooldown",
      message: "This posting is already generating — check back in a bit.",
    });
  });

  it("429 budget_exceeded returns the shared-budget message", () => {
    expect(interpretTailorResponse(429, { error: "budget_exceeded" })).toEqual({
      kind: "budget_exceeded",
      message: "This month's shared budget is used up — try again next month.",
    });
  });

  it("503 not_configured returns a config error", () => {
    expect(interpretTailorResponse(503, { error: "tailor dispatch is not configured" })).toEqual({
      kind: "error",
      message: "Tailoring isn't configured yet — try again later.",
    });
  });

  it("502 dispatch_failed falls back to the body's error text", () => {
    expect(interpretTailorResponse(502, { error: "dispatch failed" })).toEqual({
      kind: "error",
      message: "dispatch failed",
    });
  });

  it("unrecognized error body falls back to a generic message", () => {
    expect(interpretTailorResponse(500, {})).toEqual({
      kind: "error",
      message: "Something went wrong.",
    });
  });
});
