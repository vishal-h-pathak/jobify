import { describe, expect, it } from "vitest";
import { buildEmailRedirectTo, canResend } from "./loginHelpers";

describe("buildEmailRedirectTo", () => {
  it("points at the callback with no next param when next is null", () => {
    expect(buildEmailRedirectTo("https://jobify.example", null)).toBe(
      "https://jobify.example/auth/callback"
    );
  });

  it("carries an encoded next (with its own querystring) through to the callback", () => {
    expect(buildEmailRedirectTo("https://jobify.example", "/invite?code=ABC-123")).toBe(
      "https://jobify.example/auth/callback?next=%2Finvite%3Fcode%3DABC-123"
    );
  });
});

describe("canResend", () => {
  it("is false before 30s have elapsed", () => {
    expect(canResend(1_000, 1_000 + 29_999)).toBe(false);
  });

  it("is true once 30s have elapsed", () => {
    expect(canResend(1_000, 1_000 + 30_000)).toBe(true);
  });
});
