import { describe, expect, it } from "vitest";
import { describeProfileStatus } from "./ApplicationDefaultsCard";

describe("describeProfileStatus", () => {
  it("null profile (never saved) says not set up yet", () => {
    expect(describeProfileStatus(null)).toBe("Not set up yet.");
  });

  it("a profile with no updated_at just says saved", () => {
    expect(describeProfileStatus({ contact: {}, authorization: {}, logistics: {}, self_id: {} })).toBe("Saved.");
  });

  it("formats updated_at as a short UTC date, independent of the test runner's local timezone", () => {
    const profile = {
      contact: {},
      authorization: {},
      logistics: {},
      self_id: {},
      updated_at: "2026-07-18T00:00:00Z",
    };
    expect(describeProfileStatus(profile)).toBe("Last updated Jul 18, 2026.");
  });
});
