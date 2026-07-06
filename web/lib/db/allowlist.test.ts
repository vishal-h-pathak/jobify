import { describe, expect, it, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consumeAllowlistedEmail } from "./allowlist";

/**
 * Routes by table name, tracking every call so tests can assert exact
 * arguments (case-insensitive email lookups, etc). `.then` resolves based
 * on which entry method (select/insert/update) started the chain, mirroring
 * web/lib/admin/invites.test.ts's chainable-fake pattern but across two
 * tables (`allowed_emails`, `invites`).
 */
function fakeAdmin(results: {
  select?: { data: unknown; error: unknown };
  insert?: { data: unknown; error: unknown };
  invitesUpdate?: { error: unknown };
  allowedUpdate?: { error: unknown };
}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  function makeChain(table: string) {
    let kind: "select" | "insert" | "update" | null = null;
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "insert", "update"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        if (method === "select" || method === "insert" || method === "update") {
          kind = method as "select" | "insert" | "update";
        }
        return chain;
      };
    }
    chain.maybeSingle = async () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return results.select ?? { data: null, error: null };
    };
    chain.then = (resolve: (v: unknown) => void) => {
      if (table === "invites" && kind === "insert") return resolve(results.insert ?? { data: null, error: null });
      if (table === "invites" && kind === "update") return resolve(results.invitesUpdate ?? { error: null });
      if (table === "allowed_emails" && kind === "update") return resolve(results.allowedUpdate ?? { error: null });
      return resolve({ data: null, error: null });
    };
    return chain;
  }

  const admin = { from: (table: string) => makeChain(table) };
  return { admin: admin as unknown as SupabaseClient<Database>, calls };
}

function user(email: string, id = "user-1"): User {
  return { id, email } as User;
}

describe("consumeAllowlistedEmail", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("hit: mints an invite, claims it for the user, marks the row consumed, and returns true", async () => {
    const { admin, calls } = fakeAdmin({
      select: { data: { email: "friend@example.com" }, error: null },
      insert: { data: null, error: null },
      invitesUpdate: { error: null },
      allowedUpdate: { error: null },
    });

    const result = await consumeAllowlistedEmail(admin, user("friend@example.com"));

    expect(result).toBe(true);
    const inviteInsert = calls.find((c) => c.table === "invites" && c.method === "insert");
    expect(inviteInsert).toBeDefined();
    const insertedCode = (inviteInsert!.args[0] as Array<{ code: string }>)[0].code;

    const inviteUpdate = calls.find((c) => c.table === "invites" && c.method === "update");
    expect(inviteUpdate!.args[0]).toMatchObject({ claimed_by: "user-1" });
    const inviteUpdateEq = calls.find((c) => c.table === "invites" && c.method === "eq");
    expect(inviteUpdateEq!.args).toEqual(["code", insertedCode]);

    const allowedUpdate = calls.find((c) => c.table === "allowed_emails" && c.method === "update");
    expect(allowedUpdate!.args[0]).toMatchObject({ consumed_by: "user-1" });
  });

  it("miss: no matching allowlist row — never mints an invite, returns false", async () => {
    const { admin, calls } = fakeAdmin({ select: { data: null, error: null } });

    const result = await consumeAllowlistedEmail(admin, user("stranger@example.com"));

    expect(result).toBe(false);
    expect(calls.some((c) => c.table === "invites")).toBe(false);
  });

  it("already-consumed: the select filters on consumed_by IS NULL, so a consumed row also reads as null — never re-consumed", async () => {
    const { admin, calls } = fakeAdmin({ select: { data: null, error: null } });

    const result = await consumeAllowlistedEmail(admin, user("friend@example.com"));

    expect(result).toBe(false);
    const isCall = calls.find((c) => c.table === "allowed_emails" && c.method === "is");
    expect(isCall!.args).toEqual(["consumed_by", null]);
  });

  it("email matching is case-insensitive — the lookup lowercases before querying", async () => {
    const { admin, calls } = fakeAdmin({ select: { data: null, error: null } });

    await consumeAllowlistedEmail(admin, user("Friend@Example.COM"));

    const eqCall = calls.find((c) => c.table === "allowed_emails" && c.method === "eq");
    expect(eqCall!.args).toEqual(["email", "friend@example.com"]);
  });

  it("no user email: returns false without querying anything", async () => {
    const { admin, calls } = fakeAdmin({});

    const result = await consumeAllowlistedEmail(admin, { id: "user-1", email: undefined } as unknown as User);

    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("failure mid-sequence (invite claim update errors) falls through safely, returning false", async () => {
    const { admin } = fakeAdmin({
      select: { data: { email: "friend@example.com" }, error: null },
      insert: { data: null, error: null },
      invitesUpdate: { error: new Error("boom") },
    });

    const result = await consumeAllowlistedEmail(admin, user("friend@example.com"));

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("failure mid-sequence (marking the allowlist row consumed errors) falls through safely, returning false", async () => {
    const { admin } = fakeAdmin({
      select: { data: { email: "friend@example.com" }, error: null },
      insert: { data: null, error: null },
      invitesUpdate: { error: null },
      allowedUpdate: { error: new Error("boom") },
    });

    const result = await consumeAllowlistedEmail(admin, user("friend@example.com"));

    expect(result).toBe(false);
  });

  it("failure in the initial select falls through safely, returning false", async () => {
    const { admin } = fakeAdmin({ select: { data: null, error: new Error("boom") } });

    const result = await consumeAllowlistedEmail(admin, user("friend@example.com"));

    expect(result).toBe(false);
  });
});
