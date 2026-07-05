import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

describe("Button", () => {
  it("renders a button with the secondary variant by default", () => {
    const result = Button({ children: "Save" });
    expect(result.type).toBe("button");
    expect(result.props.type).toBe("button");
    expect(result.props.disabled).toBe(false);
    expect(result.props.className).toMatch(/bg-surface/);
    expect(result.props.children).toEqual([false, "Save"]);
  });

  it("applies the primary (amber) variant classes", () => {
    const result = Button({ children: "Continue", variant: "primary" });
    expect(result.props.className).toMatch(/bg-amber/);
  });

  it("applies the danger-ghost variant classes", () => {
    const result = Button({ children: "Remove", variant: "danger-ghost" });
    expect(result.props.className).toMatch(/text-danger/);
  });

  it("disables the button and shows a spinner when busy", () => {
    const result = Button({ children: "Saving", busy: true });
    expect(result.props.disabled).toBe(true);
    const [spinner] = result.props.children;
    expect(spinner.type).toBe(Spinner);
  });

  it("stays disabled when disabled is passed explicitly", () => {
    const result = Button({ children: "Save", disabled: true });
    expect(result.props.disabled).toBe(true);
  });
});
