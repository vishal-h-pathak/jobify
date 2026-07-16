import { describe, expect, it } from "vitest";
import { visibleNavLinks } from "./NavLinks";

describe("visibleNavLinks", () => {
  it("shows Feed · Profile · Settings for a non-admin authed user", () => {
    expect(visibleNavLinks(false)).toEqual([
      { href: "/feed", label: "Feed" },
      { href: "/profile", label: "Profile" },
      { href: "/settings", label: "Settings" },
    ]);
  });

  it("adds Admin at the end for an admin user, without dropping Profile", () => {
    expect(visibleNavLinks(true)).toEqual([
      { href: "/feed", label: "Feed" },
      { href: "/profile", label: "Profile" },
      { href: "/settings", label: "Settings" },
      { href: "/admin", label: "Admin" },
    ]);
  });
});
