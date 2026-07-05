import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const hasClaimedInviteMock = vi.fn();
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

const { default: AppLayout } = await import("./layout");

describe("(app) layout — invite gate", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    hasClaimedInviteMock.mockClear();
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
    const [header, main, footer] = result.props.children;

    const [wordmarkLink, navGroup] = header.props.children.props.children;
    expect(wordmarkLink.props.href).toBe("/feed");
    const [navLinks, signOutButton] = navGroup.props.children;
    expect(navLinks.type.name).toBe("NavLinks");
    expect(signOutButton.type.name).toBe("SignOutButton");

    expect(main.props.children).toBe("content");
    expect(footer.props.children).toMatch(/private beta for friends/);
  });
});
