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

describe("TextArea autosize", () => {
  it("defaults to the minimum 3 rows for a short or empty value", () => {
    expect(TextArea({ value: "short answer" }).props.rows).toBe(3);
    expect(TextArea({}).props.rows).toBe(3);
  });

  it("grows rows with explicit newlines, up to the value's line count", () => {
    const fiveLines = "one\ntwo\nthree\nfour\nfive";
    expect(TextArea({ value: fiveLines }).props.rows).toBe(5);
  });

  it("caps growth at 8 rows for long input", () => {
    const longValue = "a".repeat(500);
    expect(TextArea({ value: longValue }).props.rows).toBe(8);
  });

  it("an explicit rows prop always wins over the autosize estimate", () => {
    const longValue = "a".repeat(500);
    expect(TextArea({ value: longValue, rows: 3 }).props.rows).toBe(3);
  });
});
