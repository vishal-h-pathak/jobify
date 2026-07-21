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

interface TestDeckScenario {
  id: string;
  title: string;
  org_flavor: string;
  gist: string;
  probe: string;
}

// INT2-B: the one metered LLM call (deck generation). Default to returning
// no usable scenarios so every pre-existing test in this file — none of
// which know about the deck — exercises the static (live-postings)
// fallback exactly as before; individual deck tests override this mock.
const runDeckGenerationTurnMock = vi.fn<
  () => Promise<{ scenarios: TestDeckScenario[]; usage: { inputTokens: number; outputTokens: number } }>
>(async () => ({ scenarios: [], usage: { inputTokens: 10, outputTokens: 5 } }));
vi.mock("@/lib/anthropic/moduleTurns", () => ({ runDeckGenerationTurn: runDeckGenerationTurnMock }));

vi.mock("@/lib/anthropic/client", () => ({ ONBOARDING_MODEL: "claude-sonnet-5" }));

const recordOnboardingTurnMock = vi.fn(async () => {});
vi.mock("@/lib/db/ledger", () => ({ recordOnboardingTurn: recordOnboardingTurnMock }));

const { GET, POST } = await import("./route");

const BASE_SESSION = {
  user_id: "user-1",
  stage: "targeting",
  messages: [],
  extracted: { anchor: { current_title: "Senior Backend Engineer" } },
  modules: {},
  status: "in_progress",
};

function deckScenario(overrides: Partial<{ id: string; title: string; org_flavor: string; gist: string; probe: string }> = {}) {
  return {
    id: overrides.id ?? "scenario_1",
    title: overrides.title ?? "Senior Ops Manager",
    org_flavor: overrides.org_flavor ?? "a 50-person B2B SaaS company",
    gist: overrides.gist ?? "Runs the weekly ops review and owns vendor contracts.",
    probe: overrides.probe ?? "scope",
  };
}

/** 8 scenarios spanning >=4 distinct probe dimensions — passes deckIsUsable. */
function usableDeck() {
  const probes = ["scope", "pace", "autonomy", "domain", "scope", "pace", "autonomy", "domain"];
  return probes.map((probe, i) => deckScenario({ id: `scenario_${i + 1}`, probe }));
}

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
    runDeckGenerationTurnMock.mockReset();
    runDeckGenerationTurnMock.mockResolvedValue({ scenarios: [], usage: { inputTokens: 10, outputTokens: 5 } });
    recordOnboardingTurnMock.mockReset();
    saveSessionMock.mockClear();
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

  it("generates and persists a deck when reaction_deck is absent, and records a metered deck_gen ledger row", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const deck = usableDeck();
    runDeckGenerationTurnMock.mockResolvedValue({ scenarios: deck, usage: { inputTokens: 200, outputTokens: 300 } });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.postings).toEqual(
      deck.map((s) => ({ id: s.id, title: s.title, company: null, location: null, org_flavor: s.org_flavor, gist: s.gist }))
    );
    expect(runDeckGenerationTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledWith(
      { __admin: true },
      expect.objectContaining({ userId: "user-1", model: "claude-sonnet-5", inputTokens: 200, outputTokens: 300, event: "deck_gen" })
    );
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ extracted: expect.objectContaining({ reaction_deck: deck }) })
    );
  });

  it("serves the stored deck without generating again once reaction_deck already exists", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const deck = usableDeck();
    getOrCreateSessionMock.mockResolvedValue({ ...BASE_SESSION, extracted: { ...BASE_SESSION.extracted, reaction_deck: deck } });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.postings.map((p: { id: string }) => p.id)).toEqual(deck.map((s) => s.id));
    expect(runDeckGenerationTurnMock).not.toHaveBeenCalled();
    expect(recordOnboardingTurnMock).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("regenerates once when the first attempt fails the dimension-spread check, then persists the usable second attempt", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const badDeck = Array.from({ length: 8 }, (_, i) => deckScenario({ id: `bad_${i + 1}`, probe: "scope" })); // only 1 dimension
    const goodDeck = usableDeck();
    runDeckGenerationTurnMock
      .mockResolvedValueOnce({ scenarios: badDeck, usage: { inputTokens: 10, outputTokens: 10 } })
      .mockResolvedValueOnce({ scenarios: goodDeck, usage: { inputTokens: 10, outputTokens: 10 } });

    const res = await GET();

    expect(runDeckGenerationTurnMock).toHaveBeenCalledTimes(2);
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(2); // both attempts are metered, even the discarded one
    const body = await res.json();
    expect(body.postings.map((p: { id: string }) => p.id)).toEqual(goodDeck.map((s) => s.id));
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ extracted: expect.objectContaining({ reaction_deck: goodDeck }) })
    );
  });

  it("falls back to the static (live-postings) deck without persisting anything when generation fails the check twice", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const badDeck = Array.from({ length: 8 }, (_, i) => deckScenario({ id: `bad_${i + 1}`, probe: "scope" }));
    runDeckGenerationTurnMock.mockResolvedValue({ scenarios: badDeck, usage: { inputTokens: 10, outputTokens: 10 } });
    supabaseStub = makeSupabaseStub({
      postings: {
        data: [{ id: "p1", title: "Senior Backend Engineer", company: "Acme", location: "Remote", last_seen_at: "2026-07-10T00:00:00Z" }],
        error: null,
      },
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.postings).toEqual([{ id: "p1", title: "Senior Backend Engineer", company: "Acme", location: "Remote" }]);
    // never-persist-empty/partial: the unusable deck must never land in extracted.reaction_deck
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("never persists a deck shorter than 8 scenarios, even if every probe dimension is distinct", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const shortDeck = ["scope", "pace", "autonomy", "domain"].map((probe, i) => deckScenario({ id: `s_${i + 1}`, probe }));
    runDeckGenerationTurnMock.mockResolvedValue({ scenarios: shortDeck, usage: { inputTokens: 10, outputTokens: 10 } });
    supabaseStub = makeSupabaseStub({ postings: { data: [], error: null } });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(saveSessionMock).not.toHaveBeenCalled();
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
    runDeckGenerationTurnMock.mockClear();
    recordOnboardingTurnMock.mockClear();
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
    expect(runDeckGenerationTurnMock).not.toHaveBeenCalled();
    expect(recordOnboardingTurnMock).not.toHaveBeenCalled();
  });

  // INT2-B: deck cards are fictional scenarios — posting_reactions.posting_id
  // has a hard FK to postings.id (migration 0011), so a deck-card reaction
  // must skip that table entirely and use the card's own title/org_flavor.
  describe("deck-card reactions (INT2-B)", () => {
    const deck = [
      { id: "scenario_1", title: "Senior Ops Manager", org_flavor: "a 50-person B2B SaaS company", gist: "Runs vendor contracts.", probe: "scope" },
    ];

    it("reacting to a deck-card id skips the postings lookup and posting_reactions upsert entirely", async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
      hasAccessMock.mockResolvedValue(true);
      getOrCreateSessionMock.mockResolvedValue({ ...BASE_SESSION, extracted: { ...BASE_SESSION.extracted, reaction_deck: deck } });
      // No postingLookup override needed — if the route touched `postings`/
      // `posting_reactions` for this id, the stub's default (data: null)
      // would 404, and the upsert mock would be called; assert neither.
      supabaseStub = makeSupabaseStub({ postingLookup: { data: null, error: null } });

      const res = await POST(postRequest({ posting_id: "scenario_1", reaction: "interested" }));

      expect(res.status).toBe(200);
      expect(supabaseStub.__upsertMock).not.toHaveBeenCalled();
      expect(saveSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        expect.objectContaining({
          extracted: expect.objectContaining({
            reactions: [{ posting_id: "scenario_1", title: "Senior Ops Manager", company: "a 50-person B2B SaaS company", reaction: "interested" }],
          }),
        })
      );
    });

    it("falls through to the real-postings path for an id that isn't in the stored deck", async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
      hasAccessMock.mockResolvedValue(true);
      getOrCreateSessionMock.mockResolvedValue({ ...BASE_SESSION, extracted: { ...BASE_SESSION.extracted, reaction_deck: deck } });

      const res = await POST(postRequest({ posting_id: "p1", reaction: "interested" }));

      expect(res.status).toBe(200);
      expect(supabaseStub.__upsertMock).toHaveBeenCalledWith(
        { user_id: "user-1", posting_id: "p1", reaction: "interested", note: null },
        { onConflict: "user_id,posting_id" }
      );
    });
  });
});
