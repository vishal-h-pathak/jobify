import { describe, expect, it } from "vitest";
import { Badge, scoreTone } from "./Badge";

describe("scoreTone", () => {
  it("tiers scores at 0.75 and 0.5, and treats null as unscored/neutral", () => {
    expect(scoreTone(0.9)).toBe("amber");
    expect(scoreTone(0.75)).toBe("amber");
    expect(scoreTone(0.6)).toBe("blue");
    expect(scoreTone(0.5)).toBe("blue");
    expect(scoreTone(0.2)).toBe("neutral");
    expect(scoreTone(null)).toBe("neutral");
  });
});

describe("Badge", () => {
  it("renders children inside a pill with tone-specific classes", () => {
    const result = Badge({ tone: "amber", children: "92%" });
    expect(result.type).toBe("span");
    expect(result.props.className).toMatch(/text-amber/);
    expect(result.props.children).toBe("92%");
  });

  it("defaults to the neutral tone", () => {
    const result = Badge({ children: "unscored" });
    expect(result.props.className).toMatch(/text-ink-muted/);
  });
});
