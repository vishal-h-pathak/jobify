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

  it("default variant renders the exact original class string — zero visual regression", () => {
    const result = Card({ children: "content" });
    expect(result.props.className.trim()).toBe("rounded-lg border border-line bg-surface p-4");
  });

  it("quiet variant drops the border and uses a translucent surface", () => {
    const result = Card({ children: "content", variant: "quiet" });
    expect(result.props.className).toMatch(/bg-surface\/50/);
    expect(result.props.className).not.toMatch(/border-line/);
  });

  it("elevated variant keeps the border and adds shadow", () => {
    const result = Card({ children: "content", variant: "elevated" });
    expect(result.props.className).toMatch(/border-line/);
    expect(result.props.className).toMatch(/shadow-lg/);
    expect(result.props.className).toMatch(/shadow-black\/20/);
  });
});
