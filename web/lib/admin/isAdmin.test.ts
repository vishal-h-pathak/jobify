import { describe, expect, it, afterEach } from "vitest";
import { isAdmin } from "./isAdmin";

const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;

afterEach(() => {
  if (ORIGINAL_ADMIN_EMAILS === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
});

describe("isAdmin", () => {
  it("matches an exact email", () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    expect(isAdmin({ email: "admin@example.com" })).toBe(true);
  });

  it("is case-insensitive on both sides", () => {
    process.env.ADMIN_EMAILS = "Admin@Example.com";
    expect(isAdmin({ email: "ADMIN@EXAMPLE.COM" })).toBe(true);
  });

  it("trims whitespace on both sides", () => {
    process.env.ADMIN_EMAILS = " admin@example.com ";
    expect(isAdmin({ email: "  admin@example.com  " })).toBe(true);
  });

  it("matches any email in a comma-separated list", () => {
    process.env.ADMIN_EMAILS = "a@example.com,admin@example.com,b@example.com";
    expect(isAdmin({ email: "admin@example.com" })).toBe(true);
    expect(isAdmin({ email: "c@example.com" })).toBe(false);
  });

  it("ignores empty entries from stray commas", () => {
    process.env.ADMIN_EMAILS = "admin@example.com,,b@example.com,";
    expect(isAdmin({ email: "admin@example.com" })).toBe(true);
    expect(isAdmin({ email: "b@example.com" })).toBe(true);
    expect(isAdmin({ email: "" })).toBe(false);
  });

  it("unset env var means nobody is admin", () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAdmin({ email: "admin@example.com" })).toBe(false);
  });

  it("empty env var means nobody is admin", () => {
    process.env.ADMIN_EMAILS = "";
    expect(isAdmin({ email: "admin@example.com" })).toBe(false);
  });

  it("returns false for a signed-out / emailless user", () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin({ email: undefined })).toBe(false);
  });
});
