import { describe, expect, it } from "vitest";
import { listAllUserEmails, listUsersOverview, validationTone } from "./users";

function chainable(result: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

function fakeAdmin(opts: {
  profiles?: { data: unknown; error: unknown };
  matches?: { data: unknown; error: unknown };
  ledger?: { data: unknown; error: unknown };
  keys?: { data: unknown; error: unknown };
  listUsersPages?: Array<{ data: { users: Array<{ id: string; email: string | null }> }; error: unknown }>;
}) {
  const tables: Record<string, unknown> = {
    profiles: chainable(opts.profiles ?? { data: [], error: null }),
    matches: chainable(opts.matches ?? { data: [], error: null }),
    budget_ledger: chainable(opts.ledger ?? { data: [], error: null }),
    api_keys: chainable(opts.keys ?? { data: [], error: null }),
  };
  const pages = opts.listUsersPages ?? [{ data: { users: [] }, error: null }];
  const listUsersCalls: Array<{ page: number; perPage: number }> = [];
  return {
    admin: {
      from: (table: string) => tables[table],
      auth: {
        admin: {
          listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
            listUsersCalls.push({ page, perPage });
            return pages[page - 1] ?? { data: { users: [] }, error: null };
          },
        },
      },
    } as never,
    listUsersCalls,
  };
}

describe("validationTone", () => {
  it("is success for 'valid', danger for 'invalid', neutral otherwise", () => {
    expect(validationTone("valid")).toBe("success");
    expect(validationTone("invalid")).toBe("danger");
    expect(validationTone(null)).toBe("neutral");
    expect(validationTone("unchecked")).toBe("neutral");
  });
});

describe("listAllUserEmails", () => {
  it("returns id -> email for a single page", async () => {
    const { admin } = fakeAdmin({
      listUsersPages: [
        { data: { users: [{ id: "u1", email: "a@example.com" }, { id: "u2", email: null }] }, error: null },
      ],
    });
    const emails = await listAllUserEmails(admin);
    expect(emails.get("u1")).toBe("a@example.com");
    expect(emails.has("u2")).toBe(false);
  });

  it("paginates until a short page signals the end", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: `u${i}`, email: `u${i}@example.com` }));
    const { admin, listUsersCalls } = fakeAdmin({
      listUsersPages: [
        { data: { users: fullPage }, error: null },
        { data: { users: [{ id: "u200", email: "u200@example.com" }] }, error: null },
      ],
    });
    const emails = await listAllUserEmails(admin);
    expect(emails.size).toBe(201);
    expect(listUsersCalls).toEqual([
      { page: 1, perPage: 200 },
      { page: 2, perPage: 200 },
    ]);
  });

  it("throws on a listUsers error", async () => {
    const { admin } = fakeAdmin({ listUsersPages: [{ data: { users: [] }, error: new Error("boom") }] });
    await expect(listAllUserEmails(admin)).rejects.toThrow("boom");
  });
});

describe("listUsersOverview", () => {
  it("merges validation status, grouped match counts, pool spend, and BYO-key existence per user", async () => {
    const { admin } = fakeAdmin({
      profiles: { data: [{ user_id: "u1", validation_status: { status: "valid", errors: [] } }], error: null },
      matches: {
        data: [
          { user_id: "u1", state: "new" },
          { user_id: "u1", state: "saved" },
          { user_id: "u1", state: "saved" },
          { user_id: "u2", state: "applied" },
        ],
        error: null,
      },
      ledger: {
        data: [
          { user_id: "u1", cost_usd: 1.5 },
          { user_id: "u1", cost_usd: 0.25 },
        ],
        error: null,
      },
      keys: { data: [{ user_id: "u2" }], error: null },
    });
    const emails = new Map([
      ["u1", "one@example.com"],
      ["u2", "two@example.com"],
    ]);

    const rows = await listUsersOverview(admin, emails);
    expect(rows).toEqual([
      {
        userId: "u1",
        email: "one@example.com",
        validationStatus: "valid",
        matchCounts: { new: 1, seen: 0, saved: 2, dismissed: 0, applied: 0 },
        spendUsdMtd: 1.75,
        hasByoKey: false,
      },
      {
        userId: "u2",
        email: "two@example.com",
        validationStatus: null,
        matchCounts: { new: 0, seen: 0, saved: 0, dismissed: 0, applied: 1 },
        spendUsdMtd: 0,
        hasByoKey: true,
      },
    ]);
  });
});
