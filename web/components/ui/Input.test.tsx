import { describe, expect, it } from "vitest";
import { Input, TextArea } from "./Input";

describe("Input", () => {
  it("renders a styled text input", () => {
    const result = Input({ placeholder: "sk-ant-..." });
    expect(result.type).toBe("input");
    expect(result.props.placeholder).toBe("sk-ant-...");
    expect(result.props.className).toMatch(/border-line/);
  });
});

describe("TextArea", () => {
  it("renders a styled textarea sharing the input field classes", () => {
    const result = TextArea({ rows: 3 });
    expect(result.type).toBe("textarea");
    expect(result.props.rows).toBe(3);
    expect(result.props.className).toMatch(/border-line/);
  });
});
