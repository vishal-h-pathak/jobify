import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const hasClaimedInviteMock = vi.fn();
const isAdminMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  // Mirrors next/navigation's real redirect(): throws to unwind rendering,
  // so a layout that redirects never falls through to `return children`.
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const { default: AppLayout } = await import("./layout");

describe("(app) layout — invite gate", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    hasClaimedInviteMock.mockClear();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    redirectMock.mockClear();
  });

  it("redirects to /login when there is no session, without checking the invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(AppLayout({ children: "content" })).rejects.toThrow("REDIRECT:/login");
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("redirects to /invite when signed in but no invite is claimed — the invite gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);

    await expect(AppLayout({ children: "content" })).rejects.toThrow("REDIRECT:/invite");
  });

  it("renders the header, main content, and footer once signed in with a claimed invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);

    const result = await AppLayout({ children: "content" });
    const [handoffEmitter, header, main, footer] = result.props.children;

    expect(handoffEmitter.type.name).toBe("HandoffEmitter");
    const [wordmarkLink, navGroup] = header.props.children.props.children;
    expect(wordmarkLink.props.href).toBe("/feed");
    const [navLinks, signOutButton] = navGroup.props.children;
    expect(navLinks.type.name).toBe("NavLinks");
    expect(navLinks.props.isAdmin).toBe(false);
    expect(signOutButton.type.name).toBe("SignOutButton");

    expect(main.props.children).toBe("content");
    expect(footer.props.children).toMatch(/private beta for friends/);
  });

  it("an admin without a claimed invite bypasses the invite gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);

    const result = await AppLayout({ children: "content" });

    expect(redirectMock).not.toHaveBeenCalled();
    // Short-circuits on the admin bypass — no need to query the invite.
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
    const [, header] = result.props.children;
    const [, navGroup] = header.props.children.props.children;
    const [navLinks] = navGroup.props.children;
    expect(navLinks.props.isAdmin).toBe(true);
  });

  it("a non-admin without a claimed invite still redirects to /invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    isAdminMock.mockReturnValue(false);
    hasClaimedInviteMock.mockResolvedValue(false);

    await expect(AppLayout({ children: "content" })).rejects.toThrow("REDIRECT:/invite");
  });
});
