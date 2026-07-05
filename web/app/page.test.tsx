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

const { default: Home } = await import("./page");

describe("landing page (/)", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    hasClaimedInviteMock.mockClear();
    redirectMock.mockClear();
  });

  it("redirects signed-in visitors with a claimed invite straight to /feed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);

    await expect(Home()).rejects.toThrow("REDIRECT:/feed");
  });

  it("renders the pitch for a signed-out visitor, without checking invite state", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await Home();
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();

    const [, , , ctas] = result.props.children;
    const [inviteLink, signInLink] = ctas.props.children;
    expect(inviteLink.props.href).toBe("/invite");
    expect(signInLink.props.href).toBe("/login");
  });

  it("renders the pitch (no redirect) for a signed-in visitor with no claimed invite yet", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);

    const result = await Home();
    expect(result.props.children).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
