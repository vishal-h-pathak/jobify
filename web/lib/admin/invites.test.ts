import { describe, expect, it } from "vitest";
import { generateInviteCode, mintInvites, listInvitesForAdmin } from "./invites";

/** Chainable, thenable fake mirroring web/lib/db/matches.test.ts's pattern,
 * plus a spy on `.insert()` since mintInvites never calls `.select()`. */
function fakeAdmin(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "eq", "insert"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return { admin: { from: () => chain } as never, calls };
}

describe("generateInviteCode", () => {
  it("is 12 lowercase base64url characters — matches jobify.hosted.invites' shape", () => {
    for (let i = 0; i < 20; i += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(12);
      expect(code).toBe(code.toLowerCase());
      expect(code).toMatch(/^[a-z0-9_-]{12}$/);
    }
  });

  it("does not repeat across calls (real randomness, no collision-check needed at this scale)", () => {
    const codes = new Set(Array.from({ length: 50 }, generateInviteCode));
    expect(codes.size).toBe(50);
  });
});

describe("mintInvites", () => {
  it("mints exactly N codes and inserts each as its own row", async () => {
    const { admin, calls } = fakeAdmin({ data: null, error: null });
    const codes = await mintInvites(admin, 3);
    expect(codes).toHaveLength(3);
    const insertCall = calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual(codes.map((code) => ({ code })));
  });

  it("throws on a database error rather than silently returning partial codes", async () => {
    const { admin } = fakeAdmin({ data: null, error: new Error("boom") });
    await expect(mintInvites(admin, 1)).rejects.toThrow("boom");
  });
});

describe("listInvitesForAdmin", () => {
  it("resolves claimed_by to an email via the supplied map, and reports unclaimed codes as null", async () => {
    const { admin } = fakeAdmin({
      data: [
        { code: "aaa111222333", claimed_by: "user-1", claimed_at: "2026-07-01T00:00:00Z", created_at: "2026-06-30T00:00:00Z" },
        { code: "bbb444555666", claimed_by: null, claimed_at: null, created_at: "2026-07-02T00:00:00Z" },
      ],
      error: null,
    });
    const emails = new Map([["user-1", "admin@example.com"]]);
    const rows = await listInvitesForAdmin(admin, emails);
    expect(rows).toEqual([
      { code: "aaa111222333", createdAt: "2026-06-30T00:00:00Z", claimedByEmail: "admin@example.com", claimedAt: "2026-07-01T00:00:00Z" },
      { code: "bbb444555666", createdAt: "2026-07-02T00:00:00Z", claimedByEmail: null, claimedAt: null },
    ]);
  });

  it("falls back to the bare user id when the email map has no entry", async () => {
    const { admin } = fakeAdmin({
      data: [{ code: "ccc777888999", claimed_by: "user-2", claimed_at: "2026-07-01T00:00:00Z", created_at: "2026-06-30T00:00:00Z" }],
      error: null,
    });
    const rows = await listInvitesForAdmin(admin, new Map());
    expect(rows[0].claimedByEmail).toBe("user-2");
  });

  it("throws on a database error", async () => {
    const { admin } = fakeAdmin({ data: null, error: new Error("boom") });
    await expect(listInvitesForAdmin(admin, new Map())).rejects.toThrow("boom");
  });
});
