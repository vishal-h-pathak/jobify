import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("renders a surfaced, bordered container around its children", () => {
    const result = Card({ children: "content" });
    expect(result.type).toBe("div");
    expect(result.props.className).toMatch(/bg-surface/);
    expect(result.props.className).toMatch(/border-line/);
    expect(result.props.children).toBe("content");
  });

  it("merges extra className onto the base styles", () => {
    const result = Card({ children: "content", className: "gap-2" });
    expect(result.props.className).toMatch(/gap-2/);
  });
});
