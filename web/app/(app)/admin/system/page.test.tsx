import { describe, expect, it, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: notFoundMock }));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const listRecentHuntCyclesMock = vi.fn(async () => [] as unknown[]);
const getMostRecentScoringFunnelMock = vi.fn(async () => null as unknown);
vi.mock("@/lib/admin/systemCycles", () => ({
  listRecentHuntCycles: listRecentHuntCyclesMock,
  getMostRecentScoringFunnel: getMostRecentScoringFunnelMock,
}));

const getPoolHealthMock = vi.fn(async () => ({
  postingsCount: 0,
  newestLastSeenAt: null,
  poolSpendUsdMtd: 0,
  byoSpendUsdMtd: 0,
  globalCapUsd: 100,
}));
vi.mock("@/lib/admin/poolHealth", () => ({ getPoolHealth: getPoolHealthMock }));

const getCostBreakdownMtdMock = vi.fn(async () => ({ byEvent: {}, byModel: {}, poolUsd: 0, byoUsd: 0 }));
const getEngagementSnapshotMock = vi.fn(async () => ({
  totalsByState: { new: 0, seen: 0, saved: 0, dismissed: 0, applied: 0 },
  last7DaysByState: { new: 0, seen: 0, saved: 0, dismissed: 0, applied: 0 },
  savesToDismissalsRatio: null,
  appliedByUser: [] as unknown[],
}));
const getPoolFreshnessMock = vi.fn(async () => ({
  postingsCount: 0,
  newestLastSeenAt: null,
  oldestLastSeenAt: null,
  expiredCount: 0,
}));
vi.mock("@/lib/admin/systemMetrics", () => ({
  getCostBreakdownMtd: getCostBreakdownMtdMock,
  getEngagementSnapshot: getEngagementSnapshotMock,
  getPoolFreshness: getPoolFreshnessMock,
}));

const getSourceFunnelMock = vi.fn(async () => [] as unknown[]);
vi.mock("@/lib/admin/sourceHealth", () => ({ getSourceFunnel: getSourceFunnelMock }));
vi.mock("../DormantBoardButton", () => ({ DormantBoardButton: () => null }));

const { default: AdminSystemPage } = await import("./page");

/** Depth-first search over the raw React-element tree for a `Card` whose
 * first child's text matches `heading` exactly — robust to exactly where
 * in the top-level children array a given section lands (unlike indexing
 * by position, which `../page.test.tsx` uses for its much shorter,
 * fixed-order page). */
function findCardByHeading(node: unknown, heading: string): { props: { children: unknown } } | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findCardByHeading(child, heading);
      if (found) return found;
    }
    return null;
  }
  const el = node as { props?: { children?: unknown } };
  if (!el.props) return null;
  const kids = el.props.children;
  const first = Array.isArray(kids) ? kids[0] : kids;
  if (first && typeof first === "object" && "props" in (first as object)) {
    const firstProps = (first as { props?: { children?: unknown } }).props;
    if (firstProps?.children === heading) return el as { props: { children: unknown } };
  }
  return findCardByHeading(kids, heading);
}

describe("/admin/system page", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    notFoundMock.mockClear();
    requireAdminMock.mockReset();
    createSupabaseAdminClientMock.mockClear();
    listRecentHuntCyclesMock.mockClear();
    getMostRecentScoringFunnelMock.mockClear();
    getPoolHealthMock.mockClear();
    getCostBreakdownMtdMock.mockClear();
    getEngagementSnapshotMock.mockClear();
    getPoolFreshnessMock.mockClear();
    getSourceFunnelMock.mockClear();

    listRecentHuntCyclesMock.mockResolvedValue([]);
    getSourceFunnelMock.mockResolvedValue([]);
    getMostRecentScoringFunnelMock.mockResolvedValue(null);
    getCostBreakdownMtdMock.mockResolvedValue({ byEvent: {}, byModel: {}, poolUsd: 0, byoUsd: 0 });
    getEngagementSnapshotMock.mockResolvedValue({
      totalsByState: { new: 0, seen: 0, saved: 0, dismissed: 0, applied: 0 },
      last7DaysByState: { new: 0, seen: 0, saved: 0, dismissed: 0, applied: 0 },
      savesToDismissalsRatio: null,
      appliedByUser: [],
    });
    getPoolFreshnessMock.mockResolvedValue({
      postingsCount: 0,
      newestLastSeenAt: null,
      oldestLastSeenAt: null,
      expiredCount: 0,
    });
  });

  it("redirects signed-out visitors to /login, without touching the service-role client", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    await expect(AdminSystemPage()).rejects.toThrow("REDIRECT:/login");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("404s non-admins (never redirects — that would confirm the panel exists), without touching the service-role client", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "forbidden" });
    await expect(AdminSystemPage()).rejects.toThrow("NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("renders with empty tables (zero cycles, zero matches, zero postings) without throwing", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" }, supabase: {} });

    const result = await AdminSystemPage();

    const cyclesCard = findCardByHeading(result, "Recent hunt cycles");
    const funnelCard = findCardByHeading(result, "Latest scoring funnel");
    const engagementCard = findCardByHeading(result, "Engagement");
    const freshnessCard = findCardByHeading(result, "Pool freshness");
    const sourcesCard = findCardByHeading(result, "Sources");
    expect(cyclesCard).not.toBeNull();
    expect(funnelCard).not.toBeNull();
    expect(engagementCard).not.toBeNull();
    expect(freshnessCard).not.toBeNull();
    expect(sourcesCard).not.toBeNull();

    // Each card's second child is the conditional (EmptyState vs table/content).
    const cyclesBody = (cyclesCard!.props.children as unknown[])[1] as { type: { name?: string } };
    const funnelBody = (funnelCard!.props.children as unknown[])[1] as { type: { name?: string } };
    const engagementBody = (engagementCard!.props.children as unknown[])[1] as { type: { name?: string } };
    const freshnessBody = (freshnessCard!.props.children as unknown[])[1] as { type: { name?: string } };
    // Sources card's third child is the conditional (after heading + the
    // static flag-legend paragraph).
    const sourcesBody = (sourcesCard!.props.children as unknown[])[2] as { type: { name?: string } };
    expect(cyclesBody.type.name).toBe("EmptyState");
    expect(funnelBody.type.name).toBe("EmptyState");
    expect(engagementBody.type.name).toBe("EmptyState");
    expect(freshnessBody.type.name).toBe("EmptyState");
    expect(sourcesBody.type.name).toBe("EmptyState");

    expect(createSupabaseAdminClientMock).toHaveBeenCalled();
  });

  it("renders a rotate/dormant-candidate flag on the Sources card from fixture rollup rows", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" }, supabase: {} });
    getSourceFunnelMock.mockResolvedValue([
      {
        source: "jsearch", queryKey: "staff platform engineer", boardId: null, boardCompanyName: null,
        boardStatus: null, postings60d: 3, postings90d: 5, surfaced60d: 0, surfaced90d: 0,
        usersEngaged60d: 0, usersEngaged90d: 0, rotate: true, dormantCandidate: false,
      },
      {
        source: "greenhouse", queryKey: null, boardId: "b1", boardCompanyName: "Acme Corp",
        boardStatus: "active", postings60d: 4, postings90d: 6, surfaced60d: 0, surfaced90d: 0,
        usersEngaged60d: 0, usersEngaged90d: 0, rotate: false, dormantCandidate: true,
      },
    ]);

    const result = await AdminSystemPage();
    const sourcesCard = findCardByHeading(result, "Sources");
    expect(sourcesCard).not.toBeNull();
    const sourcesBody = (sourcesCard!.props.children as unknown[])[2] as { type: { name?: string } };
    expect(sourcesBody.type.name).not.toBe("EmptyState");
  });

  it("renders the funnel's five stages in order from a fixture counters dict", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" }, supabase: {} });
    getMostRecentScoringFunnelMock.mockResolvedValue([
      { label: "Postings considered", count: 500 },
      { label: "Passed title filter", count: 300 },
      { label: "Rubric-scored", count: 120 },
      { label: "Embedded", count: 80 },
      { label: "LLM verdicts", count: 20 },
    ]);

    const result = await AdminSystemPage();
    const funnelCard = findCardByHeading(result, "Latest scoring funnel");
    expect(funnelCard).not.toBeNull();
    const body = (funnelCard!.props.children as unknown[])[1] as { props: { children: unknown[] } };
    const rows = body.props.children as Array<{ key: string }>;
    expect(rows.map((row) => row.key)).toEqual([
      "Postings considered",
      "Passed title filter",
      "Rubric-scored",
      "Embedded",
      "LLM verdicts",
    ]);
  });

  it("renders cost breakdown totals from fixture ledger aggregation", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" }, supabase: {} });
    getCostBreakdownMtdMock.mockResolvedValue({
      byEvent: { stage4_verdict: 4.5 },
      byModel: { "claude-haiku": 4.5 },
      poolUsd: 3.5,
      byoUsd: 1,
    });

    const result = await AdminSystemPage();
    const costCard = findCardByHeading(result, "Cost");
    expect(costCard).not.toBeNull();
    // Second child (poolHealth summary) then breakdown block, not an EmptyState.
    const breakdownBody = (costCard!.props.children as unknown[])[2] as { type: { name?: string } };
    expect(breakdownBody.type.name).not.toBe("EmptyState");
  });
});
