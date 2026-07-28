import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const hasAccessMock = vi.fn();
const isAdminMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const { default: LoginPage } = await import("./page");

describe("/login page", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
  });

  describe("signed-out", () => {
    beforeEach(() => {
      getUserMock.mockResolvedValue({ data: { user: null } });
    });

    it("passes the decoded next search param through to LoginForm", async () => {
      const result = await LoginPage({ searchParams: Promise.resolve({ next: "/invite?code=ABC" }) });
      const form = result.props.children;
      expect(form.type.name).toBe("LoginForm");
      expect(form.props.next).toBe("/invite?code=ABC");
    });

    it("passes null when there is no next param", async () => {
      const result = await LoginPage({ searchParams: Promise.resolve({}) });
      const form = result.props.children;
      expect(form.props.next).toBeNull();
    });

    it("drops an unsafe next, passing null to LoginForm", async () => {
      const result = await LoginPage({ searchParams: Promise.resolve({ next: "https://evil.com" }) });
      const form = result.props.children;
      expect(form.props.next).toBeNull();
    });
  });

  describe("already signed in", () => {
    it("shows the signed-in panel with an explicit next as the continue target", async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "alex.quinn@example.com" } } });

      const result = await LoginPage({ searchParams: Promise.resolve({ next: "/tailor/abc" }) });
      const panel = result.props.children;
      expect(panel.type.name).toBe("SignedInPanel");
      expect(panel.props.email).toBe("alex.quinn@example.com");
      expect(panel.props.continueTarget).toBe("/tailor/abc");
      expect(panel.props.next).toBe("/tailor/abc");
      expect(hasAccessMock).not.toHaveBeenCalled();
    });

    it("defaults an admin's continue target to /admin without checking hasAccess", async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
      isAdminMock.mockReturnValue(true);

      const result = await LoginPage({ searchParams: Promise.resolve({}) });
      const panel = result.props.children;
      expect(panel.props.continueTarget).toBe("/admin");
      expect(hasAccessMock).not.toHaveBeenCalled();
    });

    it("defaults a non-admin with access to /feed", async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "friend@example.com" } } });
      hasAccessMock.mockResolvedValue(true);

      const result = await LoginPage({ searchParams: Promise.resolve({}) });
      const panel = result.props.children;
      expect(panel.props.continueTarget).toBe("/feed");
    });

    it("defaults a non-admin without access to /invite", async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "friend@example.com" } } });
      hasAccessMock.mockResolvedValue(false);

      const result = await LoginPage({ searchParams: Promise.resolve({}) });
      const panel = result.props.children;
      expect(panel.props.continueTarget).toBe("/invite");
    });

    it("falls back to the default target when the incoming next is unsafe", async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "friend@example.com" } } });
      hasAccessMock.mockResolvedValue(true);

      const result = await LoginPage({ searchParams: Promise.resolve({ next: "//evil.com" }) });
      const panel = result.props.children;
      expect(panel.props.continueTarget).toBe("/feed");
      expect(panel.props.next).toBeNull();
    });
  });
});
