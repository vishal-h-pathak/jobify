import { describe, expect, it, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/requireAdmin", () => ({ requireAdmin: requireAdminMock }));

const createSupabaseAdminClientMock = vi.fn(() => ({ admin: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const listAllUserEmailsMock = vi.fn(async () => new Map([["user-1", "admin@example.com"]]));
const listUsersOverviewMock = vi.fn(async () => []);
vi.mock("@/lib/admin/users", () => ({
  listAllUserEmails: listAllUserEmailsMock,
  listUsersOverview: listUsersOverviewMock,
}));

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
});
