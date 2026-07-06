import { describe, expect, it } from "vitest";
import {
  addAllowlistedEmail,
  isValidEmailShape,
  listAllowlistedEmails,
  removeAllowlistedEmail,
} from "./allowlist";

/** Chainable, thenable fake mirroring web/lib/admin/invites.test.ts's pattern. */
function fakeAdmin(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "eq", "insert", "delete"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return { admin: { from: () => chain } as never, calls };
}

describe("isValidEmailShape", () => {
  it("accepts a plausible email", () => {
    expect(isValidEmailShape("friend@example.com")).toBe(true);
  });

  it("rejects a string with no @ or no domain dot", () => {
    expect(isValidEmailShape("not-an-email")).toBe(false);
    expect(isValidEmailShape("friend@example")).toBe(false);
    expect(isValidEmailShape("")).toBe(false);
  });
});

describe("listAllowlistedEmails", () => {
  it("maps rows to camelCase, newest first per the query's own ordering", async () => {
    const { admin } = fakeAdmin({
      data: [
        { email: "a@example.com", note: "Alex", created_at: "2026-07-02T00:00:00Z", consumed_at: null },
        { email: "b@example.com", note: null, created_at: "2026-07-01T00:00:00Z", consumed_at: "2026-07-03T00:00:00Z" },
      ],
      error: null,
    });
    const rows = await listAllowlistedEmails(admin);
    expect(rows).toEqual([
      { email: "a@example.com", note: "Alex", createdAt: "2026-07-02T00:00:00Z", consumedAt: null },
      { email: "b@example.com", note: null, createdAt: "2026-07-01T00:00:00Z", consumedAt: "2026-07-03T00:00:00Z" },
    ]);
  });

  it("throws on a database error", async () => {
    const { admin } = fakeAdmin({ data: null, error: new Error("boom") });
    await expect(listAllowlistedEmails(admin)).rejects.toThrow("boom");
  });
});

describe("addAllowlistedEmail", () => {
  it("lowercases the email before insert", async () => {
    const { admin, calls } = fakeAdmin({ data: null, error: null });
    await addAllowlistedEmail(admin, "Friend@Example.COM", "Alex");
    const insertCall = calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual({ email: "friend@example.com", note: "Alex" });
  });

  it("throws on a database error (e.g. duplicate email)", async () => {
    const { admin } = fakeAdmin({ data: null, error: new Error("duplicate key") });
    await expect(addAllowlistedEmail(admin, "friend@example.com", null)).rejects.toThrow("duplicate key");
  });
});

describe("removeAllowlistedEmail", () => {
  it("lowercases the email before delete", async () => {
    const { admin, calls } = fakeAdmin({ data: null, error: null });
    await removeAllowlistedEmail(admin, "Friend@Example.COM");
    const eqCall = calls.find((c) => c.method === "eq");
    expect(eqCall?.args).toEqual(["email", "friend@example.com"]);
  });

  it("throws on a database error", async () => {
    const { admin } = fakeAdmin({ data: null, error: new Error("boom") });
    await expect(removeAllowlistedEmail(admin, "friend@example.com")).rejects.toThrow("boom");
  });
});
