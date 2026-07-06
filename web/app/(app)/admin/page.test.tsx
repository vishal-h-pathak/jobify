import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserOverviewRow } from "@/lib/admin/users";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

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

const { default: AdminPage } = await import("./page");
const { ProfileReviewRow } = await import("./ProfileReviewRow");

describe("/admin page", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    requireAdminMock.mockReset();
    createSupabaseAdminClientMock.mockClear();
    listAllUserEmailsMock.mockClear();
    listUsersOverviewMock.mockClear();
    listInvitesForAdminMock.mockClear();
    listAllowlistedEmailsMock.mockClear();
    getPoolHealthMock.mockClear();
  });

  it("redirects signed-out visitors to /login, without touching the service-role client", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/login");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("redirects non-admins to /feed, without touching the service-role client", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "forbidden" });
    await expect(AdminPage()).rejects.toThrow("REDIRECT:/feed");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("renders the four cards for an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" }, supabase: {} });

    const result = await AdminPage();
    const [heading, invitesCard, friendsCard, usersCard, poolCard] = result.props.children;

    expect(heading.props.children).toBe("Admin");
    expect(invitesCard.props.children[0].props.children).toBe("Invites");
    expect(friendsCard.props.children[0].props.children).toBe("Friends");
    expect(usersCard.props.children[0].props.children).toBe("Users");
    expect(poolCard.props.children[0].props.children).toBe("Pool health");
    expect(createSupabaseAdminClientMock).toHaveBeenCalled();
    expect(listAllowlistedEmailsMock).toHaveBeenCalled();
  });

  it("renders one ProfileReviewRow per user, passing the row data through (Review-profile wiring)", async () => {
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

    const result = await AdminPage();
    const [, , , usersCard] = result.props.children;
    const tableWrapper = usersCard.props.children[1];
    const table = tableWrapper.props.children;
    const [, tbody] = table.props.children;
    const rows = Array.isArray(tbody.props.children) ? tbody.props.children : [tbody.props.children];

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(ProfileReviewRow);
    expect(rows[0].props.user).toEqual(userRow);
  });
});
