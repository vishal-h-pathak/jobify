import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const hasClaimedInviteMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const { default: InvitePage } = await import("./page");

function searchParams(code?: string) {
  return Promise.resolve(code !== undefined ? { code } : {});
}

describe("/invite — redirect chain", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    hasClaimedInviteMock.mockClear();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    redirectMock.mockClear();
  });

  it("signed-out with a code redirects to /login, preserving the code through `next`", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(InvitePage({ searchParams: searchParams("ABC-123") })).rejects.toThrow(
      "REDIRECT:/login?next=%2Finvite%3Fcode%3DABC-123"
    );
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("signed-out with no code redirects to /login?next=/invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(InvitePage({ searchParams: searchParams() })).rejects.toThrow(
      "REDIRECT:/login?next=%2Finvite"
    );
  });

  it("signed-in admin redirects to /admin without checking hasClaimedInvite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);

    await expect(InvitePage({ searchParams: searchParams("ABC-123") })).rejects.toThrow("REDIRECT:/admin");
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("signed-in and already claimed redirects to /feed instead of showing the form again", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);

    await expect(InvitePage({ searchParams: searchParams("ABC-123") })).rejects.toThrow("REDIRECT:/feed");
  });

  it("signed-in without a claimed invite renders the claim form, pre-filled from ?code=", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams("ABC-123") });
    const [form] = result.props.children;
    expect(form.type.name).toBe("InviteForm");
    expect(form.props.initialCode).toBe("ABC-123");
  });

  it("pre-fills an empty code when none was supplied", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams() });
    const [form] = result.props.children;
    expect(form.props.initialCode).toBe("");
  });

  it("shows the codeless-signup hint alongside the claim form", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams() });
    const [, hint] = result.props.children;
    expect(hint.props.children).toContain("no code needed");
  });
});
