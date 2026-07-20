import { describe, expect, it, vi } from "vitest";

const getBudgetCapMock = vi.fn(async (..._args: unknown[]) => 5.0);
vi.mock("@/lib/db/ledger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/ledger")>("@/lib/db/ledger");
  return { ...actual, getBudgetCap: getBudgetCapMock };
});

const { getUserProfileReview } = await import("./profileReview");

function chainable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle", "gte"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

const EMPTY = { data: null, error: null };
const EMPTY_LIST = { data: [], error: null };

function fakeAdmin(opts: {
  session?: { data: unknown; error: unknown };
  profile?: { data: unknown; error: unknown };
  fullSession?: { data: unknown; error: unknown };
  matches?: { data: unknown; error: unknown };
  ledger?: { data: unknown; error: unknown };
}) {
  // The real code reads onboarding_sessions twice (once for `extracted`
  // only, once for the full row) — both calls go through the SAME chain
  // per this fake, so `fullSession` doubles as `session`'s source when the
  // extracted-only shape happens to be a subset. Tests below that care
  // about `extracted` set both consistently.
  let onboardingCall = 0;
  const onboardingResults = [opts.session ?? EMPTY, opts.fullSession ?? EMPTY];
  const tables: Record<string, () => unknown> = {
    onboarding_sessions: () => chainable(onboardingResults[onboardingCall++] ?? EMPTY),
    profiles: () => chainable(opts.profile ?? EMPTY),
    matches: () => chainable(opts.matches ?? EMPTY_LIST),
    budget_ledger: () => chainable(opts.ledger ?? EMPTY_LIST),
  };
  return { from: (table: string) => tables[table]() } as never;
}

describe("getUserProfileReview", () => {
  it("returns an empty-but-shaped review when no rows exist yet", async () => {
    const admin = fakeAdmin({});
    const review = await getUserProfileReview(admin, "user-1");
    expect(review.extracted).toEqual({});
    expect(review.doc).toBeNull();
    expect(review.validationStatus).toBeNull();
    expect(review.onboarding).toBeNull();
    expect(review.huntFeed).toEqual({
      userId: "user-1",
      byStatus: { rejected_title: 0, rejected_rubric: 0, rejected_rerank: 0, rejected_llm: 0, surfaced: 0 },
      surfacedLocationTiers: { tier1: 0, tier2: 0, tier3: 0, unknown: 0 },
    });
    expect(review.spend).toEqual({ mtdUsd: 0, capUsd: 5.0 });
  });

  it("assembles extracted + doc + validationStatus from both tables", async () => {
    const admin = fakeAdmin({
      session: { data: { extracted: { anchor: { current_title: "Engineer" } } }, error: null },
      profile: {
        data: { doc: { "cv.md": "hello", "thesis.md": "" }, validation_status: { status: "valid", errors: [] } },
        error: null,
      },
    });
    const review = await getUserProfileReview(admin, "user-1");
    expect(review.extracted).toEqual({ anchor: { current_title: "Engineer" } });
    expect(review.doc).toEqual({ "cv.md": "hello", "thesis.md": "" });
    expect(review.validationStatus).toEqual({ status: "valid", errors: [] });
  });

  it("summarizes onboarding behavior from the full session row", async () => {
    const admin = fakeAdmin({
      fullSession: {
        data: {
          user_id: "user-1",
          stage: "targeting",
          status: "in_progress",
          updated_at: "2026-07-20T10:00:00Z",
          messages: [{ role: "user", content: "hi" }],
          modules: { anchor: { completed_at: "x", receipt: "r" } },
        },
        error: null,
      },
    });
    const review = await getUserProfileReview(admin, "user-1");
    expect(review.onboarding?.turnCount).toBe(1);
    expect(review.onboarding?.stage).toBe("targeting");
    expect(review.onboarding?.modules.find((m) => m.key === "anchor")?.done).toBe(true);
  });

  it("summarizes the hunt/feed funnel from this user's matches only", async () => {
    const admin = fakeAdmin({
      matches: {
        data: [
          { user_id: "user-1", status: "surfaced", location_tier: 1 },
          { user_id: "user-1", status: "rejected_llm", location_tier: null },
        ],
        error: null,
      },
    });
    const review = await getUserProfileReview(admin, "user-1");
    expect(review.huntFeed.byStatus.surfaced).toBe(1);
    expect(review.huntFeed.byStatus.rejected_llm).toBe(1);
    expect(review.huntFeed.surfacedLocationTiers.tier1).toBe(1);
  });

  it("sums this month's pool (non-BYO) ledger rows against the user's cap", async () => {
    getBudgetCapMock.mockResolvedValueOnce(10);
    const admin = fakeAdmin({
      ledger: { data: [{ cost_usd: 1.5 }, { cost_usd: 0.75 }], error: null },
    });
    const review = await getUserProfileReview(admin, "user-1");
    expect(review.spend).toEqual({ mtdUsd: 2.25, capUsd: 10 });
  });

  it("throws if the onboarding_sessions read errors", async () => {
    const admin = fakeAdmin({ session: { data: null, error: new Error("boom") } });
    await expect(getUserProfileReview(admin, "user-1")).rejects.toThrow("boom");
  });

  it("throws if the profiles read errors", async () => {
    const admin = fakeAdmin({ profile: { data: null, error: new Error("boom") } });
    await expect(getUserProfileReview(admin, "user-1")).rejects.toThrow("boom");
  });

  it("throws if the matches read errors", async () => {
    const admin = fakeAdmin({ matches: { data: null, error: new Error("boom") } });
    await expect(getUserProfileReview(admin, "user-1")).rejects.toThrow("boom");
  });
});
