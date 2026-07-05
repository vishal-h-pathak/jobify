import { describe, expect, it } from "vitest";
import { Banner } from "./Banner";

describe("Banner", () => {
  it("renders an alert region with danger tone classes", () => {
    const result = Banner({ tone: "danger", children: "content" });
    expect(result.type).toBe("div");
    expect(result.props.role).toBe("alert");
    expect(result.props.className).toMatch(/border-danger/);
    expect(result.props.children).toBe("content");
  });

  it("defaults to the info tone", () => {
    const result = Banner({ children: "content" });
    expect(result.props.className).toMatch(/border-badge-blue/);
  });
});
