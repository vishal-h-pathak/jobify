import { describe, expect, it } from "vitest";
import { toAtsMapKind } from "./atsMap";

describe("toAtsMapKind", () => {
  it("passes through the four L0-mapped kinds", () => {
    expect(toAtsMapKind("greenhouse")).toBe("greenhouse");
    expect(toAtsMapKind("lever")).toBe("lever");
    expect(toAtsMapKind("ashby")).toBe("ashby");
    expect(toAtsMapKind("workday")).toBe("workday");
  });

  it("maps every unmapped ats_kind to generic", () => {
    expect(toAtsMapKind("icims")).toBe("generic");
    expect(toAtsMapKind("smartrecruiters")).toBe("generic");
    expect(toAtsMapKind("linkedin")).toBe("generic");
    expect(toAtsMapKind("generic")).toBe("generic");
    expect(toAtsMapKind("something-unseen")).toBe("generic");
  });
});
