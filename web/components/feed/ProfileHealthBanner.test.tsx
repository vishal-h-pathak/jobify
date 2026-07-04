import { describe, expect, it } from "vitest";
import { ProfileHealthBanner } from "./ProfileHealthBanner";

describe("ProfileHealthBanner", () => {
  it("renders every validation error and a link back to onboarding", () => {
    const result = ProfileHealthBanner({ errors: ["missing cv.md", "invalid comp_floor_usd"] });
    const [paragraph, list, link] = result.props.children;
    expect(paragraph.props.children).toMatch(/needs a fix/);
    const items = list.props.children.map((li: { props: { children: string } }) => li.props.children);
    expect(items).toEqual(["missing cv.md", "invalid comp_floor_usd"]);
    expect(link.props.href).toBe("/onboarding");
  });

  it("renders no list items when there are no errors", () => {
    const result = ProfileHealthBanner({ errors: [] });
    const [, list] = result.props.children;
    expect(list.props.children).toEqual([]);
  });
});
