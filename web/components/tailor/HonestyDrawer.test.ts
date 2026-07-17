import { describe, expect, it } from "vitest";
import { summarizeDropped } from "./HonestyDrawer";

describe("summarizeDropped", () => {
  it("singularizes a single dropped claim", () => {
    expect(summarizeDropped([{ id: "r.exp0.b3", text: "x", reason: "missing_span" }])).toBe("1 claim withheld");
  });

  it("pluralizes multiple dropped claims", () => {
    expect(
      summarizeDropped([
        { id: "r.exp0.b3", text: "x", reason: "missing_span" },
        { id: "r.exp0.b4", text: "y", reason: "number_not_confirmed" },
      ])
    ).toBe("2 claims withheld");
  });

  it("empty list summarizes to zero", () => {
    expect(summarizeDropped([])).toBe("0 claims withheld");
  });
});
