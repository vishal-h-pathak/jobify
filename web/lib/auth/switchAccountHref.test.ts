import { describe, expect, it } from "vitest";
import { switchAccountHref } from "./switchAccountHref";

describe("switchAccountHref", () => {
  it("points at bare /login when there is no next", () => {
    expect(switchAccountHref(null)).toBe("/login");
  });

  it("carries an encoded next through to /login", () => {
    expect(switchAccountHref("/invite?code=ABC-123")).toBe("/login?next=%2Finvite%3Fcode%3DABC-123");
  });
});
