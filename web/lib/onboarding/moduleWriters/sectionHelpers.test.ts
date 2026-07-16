import { describe, expect, it } from "vitest";
import { bulletList, upsertMarkdownSection } from "./sectionHelpers";

describe("upsertMarkdownSection", () => {
  it("appends a new heading + body into an empty document", () => {
    const result = upsertMarkdownSection("", "## Energy signals", "- a\n- b");
    expect(result).toBe("## Energy signals\n\n- a\n- b\n");
  });

  it("appends a new heading after existing content, preserving it", () => {
    const result = upsertMarkdownSection("# Hunting thesis\n\nSome summary.", "## Energy signals", "- a\n- b");
    expect(result).toBe("# Hunting thesis\n\nSome summary.\n\n## Energy signals\n\n- a\n- b\n");
  });

  it("replaces an existing section's body in place, not duplicating the heading", () => {
    const original = "# Hunting thesis\n\n## Energy signals\n\n- old line\n\n## Tiers\n\n- Tier A\n";
    const result = upsertMarkdownSection(original, "## Energy signals", "- new line");
    expect(result).toBe("# Hunting thesis\n\n## Energy signals\n\n- new line\n\n## Tiers\n\n- Tier A\n");
    expect(result.match(/## Energy signals/g)).toHaveLength(1);
  });

  it("re-submitting the same content is idempotent", () => {
    const once = upsertMarkdownSection("# Hunting thesis\n", "## What matters (chosen under trade-off)", "- Mission-driven work");
    const twice = upsertMarkdownSection(once, "## What matters (chosen under trade-off)", "- Mission-driven work");
    expect(twice).toBe(once);
  });

  it("only touches its own section when other headings surround it", () => {
    const original = "## Before\n\nkeep me\n\n## Mine\n\nold\n\n## After\n\nkeep me too\n";
    const result = upsertMarkdownSection(original, "## Mine", "new");
    expect(result).toBe("## Before\n\nkeep me\n\n## Mine\n\nnew\n\n## After\n\nkeep me too\n");
  });
});

describe("bulletList", () => {
  it("renders one bullet per item", () => {
    expect(bulletList(["a", "b"])).toBe("- a\n- b");
  });

  it("renders an empty string for no items", () => {
    expect(bulletList([])).toBe("");
  });
});
