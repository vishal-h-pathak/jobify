import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const hasAccessMock = vi.fn();
const intakeCompleteMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));
vi.mock("@/lib/onboarding/intakeComplete", () => ({ intakeComplete: intakeCompleteMock }));

const { default: Home } = await import("./page");

describe("landing page (/)", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    hasAccessMock.mockClear();
    intakeCompleteMock.mockReset();
    intakeCompleteMock.mockResolvedValue(true);
    redirectMock.mockClear();
  });

  it("redirects signed-in visitors with access (fresh session, no prior cookies) and a complete intake straight to /feed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);

    await expect(Home()).rejects.toThrow("REDIRECT:/feed");
  });

  it("redirects signed-in visitors with access but an incomplete intake to /onboarding, not /feed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    intakeCompleteMock.mockResolvedValue(false);

    await expect(Home()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("renders the pitch for a signed-out visitor, without checking access or intake state", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await Home();
    expect(hasAccessMock).not.toHaveBeenCalled();
    expect(intakeCompleteMock).not.toHaveBeenCalled();

    const [, , , ctas] = result.props.children;
    const [inviteLink, signInLink] = ctas.props.children;
    expect(inviteLink.props.href).toBe("/invite");
    expect(signInLink.props.href).toBe("/login");
  });

  it("2026-07-21 fix: Sign in is the primary CTA, not I have an invite — auth comes before any invite step", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await Home();
    const [, , , ctas] = result.props.children;
    const [inviteLink, signInLink] = ctas.props.children;
    expect(signInLink.props.className).toMatch(/bg-amber/);
    expect(inviteLink.props.className).not.toMatch(/bg-amber/);
  });

  it("2026-07-21 fix: an authenticated visitor with no access (unclaimed, not allowlisted, not admin) redirects to /invite — never the pitch", async () => {
    // Previously this branch rendered the marketing pitch for ANY signed-in
    // visitor without a claimed invite, authenticated or not distinguishing
    // allowlist status. The pitch is now anon-only; every authenticated
    // visitor is routed onward by the same hasAccess predicate every other
    // gate uses.
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);

    await expect(Home()).rejects.toThrow("REDIRECT:/invite");
    expect(intakeCompleteMock).not.toHaveBeenCalled();
  });

  it("renders the 3 pitch steps as a visibly numbered list", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await Home();
    const [, steps] = result.props.children;

    expect(steps.type).toBe("ol");
    expect(steps.props.className).toMatch(/list-decimal/);
    expect(steps.props.children).toHaveLength(3);
  });

  it("renders the CTA pair side by side, not stacked", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await Home();
    const [, , , ctas] = result.props.children;

    expect(ctas.props.className).not.toMatch(/flex-col/);
  });
});
