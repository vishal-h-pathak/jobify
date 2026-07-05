import { describe, expect, it } from "vitest";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders an accessible status svg with the animate-spin class", () => {
    const result = Spinner({});
    expect(result.type).toBe("svg");
    expect(result.props.role).toBe("status");
    expect(result.props.className).toMatch(/animate-spin/);
  });

  it("accepts a size override", () => {
    const result = Spinner({ className: "h-6 w-6" });
    expect(result.props.className).toMatch(/h-6 w-6/);
  });
});
