import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const hasAccessMock = vi.fn();
const isAdminMock = vi.fn();
const intakeCompleteMock = vi.fn();
const completedModuleCountMock = vi.fn();
const deriveWelcomeBackMock = vi.fn();
const maybeSingleMock = vi.fn();
const fromMock = vi.fn();
const headersMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  // Mirrors next/navigation's real redirect(): throws to unwind rendering,
  // so a layout that redirects never falls through to `return children`.
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock }, from: fromMock })),
}));
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));
vi.mock("@/lib/onboarding/intakeComplete", () => ({ intakeComplete: intakeCompleteMock }));
vi.mock("@/lib/onboarding/welcomeBack", () => ({ deriveWelcomeBack: deriveWelcomeBackMock }));
vi.mock("@/components/onboarding/moduleOrder", () => ({
  completedModuleCount: completedModuleCountMock,
  CANONICAL_MODULE_ORDER: Array.from({ length: 12 }),
}));

const { default: AppLayout } = await import("./layout");

function pathnameHeaders(pathname: string) {
  return new Headers({ "x-pathname": pathname });
}

describe("(app) layout — invite gate", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    hasAccessMock.mockClear();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    redirectMock.mockClear();
    intakeCompleteMock.mockReset();
    intakeCompleteMock.mockResolvedValue(true);
    completedModuleCountMock.mockReset();
    completedModuleCountMock.mockReturnValue(0);
    deriveWelcomeBackMock.mockReset();
    deriveWelcomeBackMock.mockReturnValue(null);
    maybeSingleMock.mockReset();
    maybeSingleMock.mockResolvedValue({ data: { modules: {}, stage: "anchor", updated_at: null }, error: null });
    fromMock.mockReset();
    fromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }));
    headersMock.mockReset();
    headersMock.mockResolvedValue(pathnameHeaders("/feed"));
  });

  it("redirects to /login when there is no session, without checking access", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(AppLayout({ children: "content" })).rejects.toThrow("REDIRECT:/login");
    expect(hasAccessMock).not.toHaveBeenCalled();
  });

  it("redirects to /invite when signed in but hasAccess is false (no claim, no allowlist hit, not admin) — the invite gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);

    await expect(AppLayout({ children: "content" })).rejects.toThrow("REDIRECT:/invite");
  });

  it("renders (fresh session, no prior cookies) once signed in with access and a complete intake — straight through, no redirect", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);

    const result = await AppLayout({ children: "content" });
    const [handoffEmitter, header, main, footer] = result.props.children;

    expect(handoffEmitter.type.name).toBe("HandoffEmitter");
    const [wordmarkLink, navGroup] = header.props.children.props.children;
    expect(wordmarkLink.props.href).toBe("/feed");
    const [navLinks, signOutButton] = navGroup.props.children;
    expect(navLinks.type.name).toBe("NavLinks");
    expect(navLinks.props.isAdmin).toBe(false);
    expect(navLinks.props.complete).toBe(true);
    expect(signOutButton.type.name).toBe("SignOutButton");

    expect(main.props.children.props.children).toBe("content");
    expect(footer.props.children).toMatch(/private beta for friends/);
  });

  it("an admin without a claimed invite bypasses the invite gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);

    const result = await AppLayout({ children: "content" });

    expect(redirectMock).not.toHaveBeenCalled();
    // Short-circuits on the admin bypass — no need to query access at all.
    expect(hasAccessMock).not.toHaveBeenCalled();
    const [, header] = result.props.children;
    const [, navGroup] = header.props.children.props.children;
    const [navLinks] = navGroup.props.children;
    expect(navLinks.props.isAdmin).toBe(true);
  });

  it("a non-admin without a claimed invite still redirects to /invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    isAdminMock.mockReturnValue(false);
    hasAccessMock.mockResolvedValue(false);

    await expect(AppLayout({ children: "content" })).rejects.toThrow("REDIRECT:/invite");
  });

  it("2026-07-21 regression: an allowlisted user (no claimed invite yet, hasAccess true via auto-claim) passes straight through, not to /invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-2", email: "allowlisted@example.com" } } });
    isAdminMock.mockReturnValue(false);
    hasAccessMock.mockResolvedValue(true);

    await expect(AppLayout({ children: "content" })).resolves.toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("(app) layout — intake gate (UX1-A)", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    hasAccessMock.mockClear();
    hasAccessMock.mockResolvedValue(true);
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    redirectMock.mockClear();
    intakeCompleteMock.mockReset();
    completedModuleCountMock.mockReset();
    completedModuleCountMock.mockReturnValue(0);
    deriveWelcomeBackMock.mockReset();
    deriveWelcomeBackMock.mockReturnValue(null);
    maybeSingleMock.mockReset();
    maybeSingleMock.mockResolvedValue({ data: { modules: {}, stage: "anchor", updated_at: null }, error: null });
    fromMock.mockReset();
    fromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }));
    headersMock.mockReset();
  });

  it.each(["/feed", "/profile", "/settings", "/tailor/abc123", "/submit/xyz"])(
    "redirects %s to /onboarding when the intake is incomplete",
    async (pathname) => {
      intakeCompleteMock.mockResolvedValue(false);
      headersMock.mockResolvedValue(pathnameHeaders(pathname));

      await expect(AppLayout({ children: "content" })).rejects.toThrow("REDIRECT:/onboarding");
    }
  );

  it("never redirects /onboarding itself, even while incomplete", async () => {
    intakeCompleteMock.mockResolvedValue(false);
    headersMock.mockResolvedValue(pathnameHeaders("/onboarding"));

    await expect(AppLayout({ children: "content" })).resolves.toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("renders once complete, without ever reading the onboarding_sessions row or headers", async () => {
    intakeCompleteMock.mockResolvedValue(true);

    await AppLayout({ children: "content" });

    expect(fromMock).not.toHaveBeenCalled();
    expect(headersMock).not.toHaveBeenCalled();
  });

  it("passes the live module progress and complete=false down to NavLinks while incomplete", async () => {
    intakeCompleteMock.mockResolvedValue(false);
    completedModuleCountMock.mockReturnValue(7);
    headersMock.mockResolvedValue(pathnameHeaders("/onboarding"));

    const result = await AppLayout({ children: "content" });
    const [, header] = result.props.children;
    const [, navGroup] = header.props.children.props.children;
    const [navLinks] = navGroup.props.children;

    expect(navLinks.props.complete).toBe(false);
    expect(navLinks.props.progress).toEqual({ completed: 7, total: 12 });
  });

  it("an admin with an incomplete intake still sees Admin in the nav", async () => {
    intakeCompleteMock.mockResolvedValue(false);
    isAdminMock.mockReturnValue(true);
    headersMock.mockResolvedValue(pathnameHeaders("/onboarding"));

    const result = await AppLayout({ children: "content" });
    const [, header] = result.props.children;
    const [, navGroup] = header.props.children.props.children;
    const [navLinks] = navGroup.props.children;

    expect(navLinks.props.isAdmin).toBe(true);
    expect(navLinks.props.complete).toBe(false);
  });

  it("wraps children in a WelcomeBackProvider carrying the derived welcome-back info", async () => {
    intakeCompleteMock.mockResolvedValue(false);
    deriveWelcomeBackMock.mockReturnValue({ moduleLabel: "energy" });
    headersMock.mockResolvedValue(pathnameHeaders("/onboarding"));

    const result = await AppLayout({ children: "content" });
    const [, , main] = result.props.children;
    const provider = main.props.children;

    expect(provider.type.name).toBe("WelcomeBackProvider");
    expect(provider.props.value).toEqual({ moduleLabel: "energy" });
    expect(provider.props.children).toBe("content");
  });
});
