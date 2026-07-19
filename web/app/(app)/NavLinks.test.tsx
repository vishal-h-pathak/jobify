import { describe, expect, it } from "vitest";
import { visibleNavLinks } from "./NavLinks";

describe("visibleNavLinks", () => {
  it("shows Feed · Profile · Settings for a complete, non-admin user", () => {
    expect(visibleNavLinks(false, true, { completed: 12, total: 12 })).toEqual([
      { href: "/feed", label: "Feed" },
      { href: "/profile", label: "Profile" },
      { href: "/settings", label: "Settings" },
    ]);
  });

  it("adds Admin at the end for a complete admin user, without dropping Profile", () => {
    expect(visibleNavLinks(true, true, { completed: 12, total: 12 })).toEqual([
      { href: "/feed", label: "Feed" },
      { href: "/profile", label: "Profile" },
      { href: "/settings", label: "Settings" },
      { href: "/admin", label: "Admin" },
    ]);
  });

  it("collapses to a single 'Your intake — N of 12' link while incomplete", () => {
    expect(visibleNavLinks(false, false, { completed: 7, total: 12 })).toEqual([
      { href: "/onboarding", label: "Your intake — 7 of 12" },
    ]);
  });

  it("keeps Admin alongside the intake link for an incomplete admin", () => {
    expect(visibleNavLinks(true, false, { completed: 0, total: 12 })).toEqual([
      { href: "/onboarding", label: "Your intake — 0 of 12" },
      { href: "/admin", label: "Admin" },
    ]);
  });
});
