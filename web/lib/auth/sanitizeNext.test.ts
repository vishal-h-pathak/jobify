import { describe, expect, it } from "vitest";
import { sanitizeNext } from "./sanitizeNext";

describe("sanitizeNext", () => {
  it("accepts a same-origin relative path", () => {
    expect(sanitizeNext("/feed")).toBe("/feed");
  });

  it("accepts a same-origin relative path with its own querystring", () => {
    expect(sanitizeNext("/invite?code=ABC-123")).toBe("/invite?code=ABC-123");
  });

  it("rejects an absolute URL (open-redirect attempt)", () => {
    expect(sanitizeNext("https://evil.com")).toBeNull();
  });

  it("rejects a protocol-relative URL (open-redirect attempt)", () => {
    expect(sanitizeNext("//evil.com")).toBeNull();
  });

  it("rejects a path that does not start with /", () => {
    expect(sanitizeNext("feed")).toBeNull();
  });

  it("returns null for null", () => {
    expect(sanitizeNext(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(sanitizeNext(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(sanitizeNext("")).toBeNull();
  });
});
