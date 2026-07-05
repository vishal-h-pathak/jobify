import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders a short heading and one secondary line, no icon", () => {
    const result = EmptyState({ heading: "Nothing yet", message: "Check back tomorrow." });
    const [heading, message] = result.props.children;
    expect(heading.props.children).toBe("Nothing yet");
    expect(message.props.children).toBe("Check back tomorrow.");
    expect(message.props.className).toMatch(/text-ink-muted/);
  });
});
