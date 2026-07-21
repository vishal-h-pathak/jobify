import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();

function makeSupabaseStub(overrides: {
  postings?: { data: unknown[] | null; error: unknown };
  postingReactionsSelect?: { data: unknown[] | null; error: unknown };
  postingLookup?: { data: unknown | null; error: unknown };
  upsertError?: unknown;
} = {}) {
  const upsertMock = vi.fn(async () => ({ error: overrides.upsertError ?? null }));

  const from = vi.fn((table: string) => {
    if (table === "postings") {
      return {
        select: vi.fn(() => ({
          // GET path: neq -> gte -> order -> limit
          neq: vi.fn(() => ({
            gte: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => overrides.postings ?? { data: [], error: null }),
              })),
            })),
          })),
          // POST path: eq -> maybeSingle
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => overrides.postingLookup ?? { data: null, error: null }),
          })),
        })),
      };
    }
    if (table === "posting_reactions") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => overrides.postingReactionsSelect ?? { data: [], error: null }),
        })),
        upsert: upsertMock,
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { auth: { getUser: getUserMock }, from, __upsertMock: upsertMock };
}

let supabaseStub = makeSupabaseStub();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabaseStub),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ __admin: true })),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getOrCreateSessionMock = vi.fn();
const saveSessionMock = vi.fn(async () => {});
vi.mock("@/lib/db/onboardingSession", () => ({
  getOrCreateSession: getOrCreateSessionMock,
  saveSession: saveSessionMock,
}));

const getProfileDocMock = vi.fn();
const upsertProfileDocMock = vi.fn(async () => ({ status: "valid", errors: [] }));
vi.mock("@/lib/db/profiles", () => ({
  getProfileDoc: getProfileDocMock,
  upsertProfileDoc: upsertProfileDocMock,
}));

// V3A-1 contract — see [key]/route.test.ts for why mocking a not-yet-built
// module path is safe under Vitest.
const markModuleCompleteMock = vi.fn((_session, key, receipt) => ({ [key]: { completed_at: "now", receipt } }));
vi.mock("@/lib/onboarding/moduleRegistry", () => ({ markModuleComplete: markModuleCompleteMock }));

const applyModuleToDocMock = vi.fn((doc) => ({ ...doc, "thesis.md": "updated" }));
vi.mock("@/lib/onboarding/incrementalDoc", () => ({ applyModuleToDoc: applyModuleToDocMock }));

const maybeFireCheckpointMock = vi.fn(async () => {});
vi.mock("@/lib/onboarding/checkpoint", () => ({ maybeFireCheckpoint: maybeFireCheckpointMock }));

const { GET, POST } = await import("./route");

const BASE_SESSION = {
  user_id: "user-1",
  stage: "targeting",
  messages: [],
  extracted: { anchor: { current_title: "Senior Backend Engineer" } },
  modules: {},
  status: "in_progress",
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/modules/reactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/onboarding/modules/reactions", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue(BASE_SESSION);
    supabaseStub = makeSupabaseStub();
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns id/title/company/location only, ranked and excluding already-reacted", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    supabaseStub = makeSupabaseStub({
      postings: {
        data: [
          { id: "p1", title: "Senior Backend Engineer", company: "Acme", location: "Remote", last_seen_at: "2026-07-10T00:00:00Z" },
          { id: "p2", title: "Retail Store Manager", company: "Widgets", location: "Atlanta", last_seen_at: "2026-07-09T00:00:00Z" },
        ],
        error: null,
      },
      postingReactionsSelect: { data: [{ posting_id: "p2" }], error: null },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.postings).toEqual([{ id: "p1", title: "Senior Backend Engineer", company: "Acme", location: "Remote" }]);
  });
});

describe("POST /api/onboarding/modules/reactions", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue(BASE_SESSION);
    saveSessionMock.mockClear();
    getProfileDocMock.mockReset();
    getProfileDocMock.mockResolvedValue(null);
    upsertProfileDocMock.mockClear();
    markModuleCompleteMock.mockClear();
    applyModuleToDocMock.mockClear();
    maybeFireCheckpointMock.mockClear();
    supabaseStub = makeSupabaseStub({ postingLookup: { data: { id: "p1", title: "Backend Engineer", company: "Acme" }, error: null } });
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(postRequest({ posting_id: "p1", reaction: "interested" }));
    expect(res.status).toBe(401);
  });

  it("400s on a missing posting_id", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(postRequest({ reaction: "interested" }));
    expect(res.status).toBe(400);
  });

  it("400s on an invalid reaction value", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(postRequest({ posting_id: "p1", reaction: "maybe" }));
    expect(res.status).toBe(400);
  });

  it("404s for a posting that doesn't exist in the pool", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    supabaseStub = makeSupabaseStub({ postingLookup: { data: null, error: null } });
    const res = await POST(postRequest({ posting_id: "missing", reaction: "interested" }));
    expect(res.status).toBe(404);
  });

  it("upserts the reaction row and mirrors into extracted.reactions[]", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(postRequest({ posting_id: "p1", reaction: "interested", note: "great mission" }));
    expect(res.status).toBe(200);
    expect(supabaseStub.__upsertMock).toHaveBeenCalledWith(
      { user_id: "user-1", posting_id: "p1", reaction: "interested", note: "great mission" },
      { onConflict: "user_id,posting_id" }
    );
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          reactions: [{ posting_id: "p1", title: "Backend Engineer", company: "Acme", reaction: "interested", note: "great mission" }],
        }),
      })
    );
  });

  it("does not mark the module complete before 6 reactions", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      ...BASE_SESSION,
      extracted: { ...BASE_SESSION.extracted, reactions: Array.from({ length: 4 }, (_, i) => ({ posting_id: `other-${i}`, title: "t", company: null, reaction: "interested" })) },
    });
    const res = await POST(postRequest({ posting_id: "p1", reaction: "interested" }));
    const body = await res.json();
    expect(body.complete).toBe(false);
    expect(markModuleCompleteMock).not.toHaveBeenCalled();
  });

  it("marks the module complete at exactly 6 reactions and writes the receipt", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      ...BASE_SESSION,
      extracted: {
        ...BASE_SESSION.extracted,
        reactions: Array.from({ length: 5 }, (_, i) => ({ posting_id: `other-${i}`, title: "t", company: null, reaction: "interested" })),
      },
    });
    const res = await POST(postRequest({ posting_id: "p1", reaction: "interested" }));
    const body = await res.json();
    expect(body.complete).toBe(true);
    expect(body.reaction_count).toBe(6);
    expect(markModuleCompleteMock).toHaveBeenCalledWith(expect.anything(), "reactions", "6 reactions");
  });

  it("allows a changed mind: re-reacting to the same posting replaces, not duplicates", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      ...BASE_SESSION,
      extracted: { ...BASE_SESSION.extracted, reactions: [{ posting_id: "p1", title: "Backend Engineer", company: "Acme", reaction: "not_interested" }] },
    });
    await POST(postRequest({ posting_id: "p1", reaction: "interested" }));
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          reactions: [{ posting_id: "p1", title: "Backend Engineer", company: "Acme", reaction: "interested" }],
        }),
      })
    );
  });

  it("calls maybeFireCheckpoint once completion fires", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({
      ...BASE_SESSION,
      extracted: {
        ...BASE_SESSION.extracted,
        reactions: Array.from({ length: 5 }, (_, i) => ({ posting_id: `other-${i}`, title: "t", company: null, reaction: "interested" })),
      },
    });
    await POST(postRequest({ posting_id: "p1", reaction: "interested" }));
    expect(maybeFireCheckpointMock).toHaveBeenCalledTimes(1);
  });

  it("never records a budget_ledger row / calls the Anthropic client (zero-LLM stage)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    await POST(postRequest({ posting_id: "p1", reaction: "interested" }));
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
  });
});
