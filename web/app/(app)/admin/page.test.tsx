import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserOverviewRow } from "@/lib/admin/users";

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

const listAllUserEmailsMock = vi.fn(async () => new Map([["user-1", "admin@example.com"]]));
const listUsersOverviewMock = vi.fn<() => Promise<UserOverviewRow[]>>(async () => []);
vi.mock("@/lib/admin/users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/users")>("@/lib/admin/users");
  return {
    validationTone: actual.validationTone,
    listAllUserEmails: listAllUserEmailsMock,
    listUsersOverview: listUsersOverviewMock,
  };
});

const listInvitesForAdminMock = vi.fn(async () => []);
vi.mock("@/lib/admin/invites", () => ({ listInvitesForAdmin: listInvitesForAdminMock }));

const listAllowlistedEmailsMock = vi.fn(async () => []);
vi.mock("@/lib/admin/allowlist", () => ({ listAllowlistedEmails: listAllowlistedEmailsMock }));

const getPoolHealthMock = vi.fn(async () => ({
  postingsCount: 0,
  newestLastSeenAt: null,
  poolSpendUsdMtd: 0,
  byoSpendUsdMtd: 0,
  globalCapUsd: 100,
}));
vi.mock("@/lib/admin/poolHealth", () => ({ getPoolHealth: getPoolHealthMock }));

const getSpendOverviewMock = vi.fn(async () => ({
  allTimeTotalUsd: 0,
  byEvent: {},
  byUser: [] as Array<{ userId: string; costUsd: number }>,
  last14Days: [] as Array<{ date: string; costUsd: number }>,
}));
vi.mock("@/lib/admin/spend", () => ({ getSpendOverview: getSpendOverviewMock }));

const getOnboardingOverviewMock = vi.fn(async () => new Map());
vi.mock("@/lib/admin/onboardingOverview", () => ({ getOnboardingOverview: getOnboardingOverviewMock }));

const { default: AdminPage } = await import("./page");
const { ProfileReviewRow } = await import("./ProfileReviewRow");

describe("/admin page", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    notFoundMock.mockClear();
    requireAdminMock.mockReset();
    createSupabaseAdminClientMock.mockClear();
    listAllUserEmailsMock.mockClear();
    listUsersOverviewMock.mockClear();
    listInvitesForAdminMock.mockClear();
    listAllowlistedEmailsMock.mockClear();
    getPoolHealthMock.mockClear();
    getSpendOverviewMock.mockClear();
    getOnboardingOverviewMock.mockClear();
  });

  it("redirects signed-out visitors to /login, without touching the service-role client", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/login");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("404s non-admins (never redirects — that would confirm the panel exists), without touching the service-role client", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "forbidden" });
    await expect(AdminPage()).rejects.toThrow("NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("renders the five cards for an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" }, supabase: {} });

    const result = await AdminPage();
    const [heading, spendCard, invitesCard, friendsCard, usersCard, candidatesCard, poolCard] =
      result.props.children;

    expect(heading.props.children).toBe("Admin");
    expect(spendCard.props.children[0].props.children).toBe("Spend");
    expect(invitesCard.props.children[0].props.children).toBe("Invites");
    expect(friendsCard.props.children[0].props.children).toBe("Friends");
    expect(usersCard.props.children[0].props.children).toBe("Users");
    expect(candidatesCard.props.children[0].props.children).toBe("Candidate boards");
    expect(poolCard.props.children[0].props.children).toBe("Pool health");
    expect(createSupabaseAdminClientMock).toHaveBeenCalled();
    expect(listAllowlistedEmailsMock).toHaveBeenCalled();
  });

  it("renders one ProfileReviewRow per user, enriched with all-time spend and onboarding data", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" }, supabase: {} });
    const userRow = {
      userId: "user-1",
      email: "friend@example.com",
      validationStatus: "valid",
      matchCounts: { new: 1, seen: 0, saved: 2, dismissed: 0, applied: 0 },
      spendUsdMtd: 1.23,
      hasByoKey: false,
    };
    listUsersOverviewMock.mockResolvedValue([userRow]);
    getSpendOverviewMock.mockResolvedValue({
      allTimeTotalUsd: 9.5,
      byEvent: { onboarding_turn: 9.5 },
      byUser: [{ userId: "user-1", costUsd: 9.5 }],
      last14Days: [],
    });
    getOnboardingOverviewMock.mockResolvedValue(
      new Map([
        [
          "user-1",
          {
            userId: "user-1",
            stage: "targeting",
            status: "in_progress",
            completedAt: null,
            lastActivityAt: "2026-07-20T10:00:00Z",
            turnCount: 4,
            fallbackCount: 0,
            loopBreakerCount: 0,
            modules: [],
          },
        ],
      ])
    );

    const result = await AdminPage();
    const [, , , , usersCard] = result.props.children;
    const tableWrapper = usersCard.props.children[1];
    const table = tableWrapper.props.children;
    const [, tbody] = table.props.children;
    const rows = Array.isArray(tbody.props.children) ? tbody.props.children : [tbody.props.children];

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(ProfileReviewRow);
    expect(rows[0].props.user).toEqual({
      ...userRow,
      spendUsdAllTime: 9.5,
      onboardingStage: "targeting",
      onboardingStatus: "in_progress",
      onboardingCompletedAt: null,
      lastActivityAt: "2026-07-20T10:00:00Z",
    });
  });
});
