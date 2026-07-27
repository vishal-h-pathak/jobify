import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const hasAccessMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const { default: InvitePage } = await import("./page");

function searchParams(code?: string, next?: string) {
  const params: { code?: string; next?: string } = {};
  if (code !== undefined) params.code = code;
  if (next !== undefined) params.next = next;
  return Promise.resolve(params);
}

describe("/invite — redirect chain", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    hasAccessMock.mockClear();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    redirectMock.mockClear();
  });

  it("signed-out with a code redirects to /login, preserving the code through `next`", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(InvitePage({ searchParams: searchParams("ABC-123") })).rejects.toThrow(
      "REDIRECT:/login?next=%2Finvite%3Fcode%3DABC-123"
    );
    expect(hasAccessMock).not.toHaveBeenCalled();
  });

  it("signed-out with no code redirects to /login?next=/invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(InvitePage({ searchParams: searchParams() })).rejects.toThrow(
      "REDIRECT:/login?next=%2Finvite"
    );
  });

  it("AUTHFLOW: signed-out preserves an incoming `next` alongside `code` through the login redirect", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const target = "/invite?" + new URLSearchParams({ code: "ABC-123", next: "/feed" }).toString();

    await expect(InvitePage({ searchParams: searchParams("ABC-123", "/feed") })).rejects.toThrow(
      `REDIRECT:/login?next=${encodeURIComponent(target)}`
    );
  });

  it("AUTHFLOW: signed-out preserves `next` when there is no code", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const target = "/invite?" + new URLSearchParams({ next: "/feed" }).toString();

    await expect(InvitePage({ searchParams: searchParams(undefined, "/feed") })).rejects.toThrow(
      `REDIRECT:/login?next=${encodeURIComponent(target)}`
    );
  });

  it("AUTHFLOW: an unsafe incoming `next` is dropped, not carried through the login redirect", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(InvitePage({ searchParams: searchParams("ABC-123", "https://evil.com") })).rejects.toThrow(
      "REDIRECT:/login?next=%2Finvite%3Fcode%3DABC-123"
    );
  });

  it("signed-in admin redirects to /admin without checking hasAccess", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);

    await expect(InvitePage({ searchParams: searchParams("ABC-123") })).rejects.toThrow("REDIRECT:/admin");
    expect(hasAccessMock).not.toHaveBeenCalled();
  });

  it("AUTHFLOW: a signed-in admin's safe `next` wins over the /admin default", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);

    await expect(InvitePage({ searchParams: searchParams(undefined, "/feed") })).rejects.toThrow("REDIRECT:/feed");
  });

  it("AUTHFLOW: a signed-in admin's unsafe `next` is rejected, falling back to /admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } } });
    isAdminMock.mockReturnValue(true);

    await expect(InvitePage({ searchParams: searchParams(undefined, "https://evil.com") })).rejects.toThrow(
      "REDIRECT:/admin"
    );
  });

  it("signed-in and already claimed redirects to /feed instead of showing the form again", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);

    await expect(InvitePage({ searchParams: searchParams("ABC-123") })).rejects.toThrow("REDIRECT:/feed");
  });

  it("AUTHFLOW: an already-claimed user's safe `next` wins over the /feed default", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);

    await expect(InvitePage({ searchParams: searchParams(undefined, "/tailor/abc") })).rejects.toThrow(
      "REDIRECT:/tailor/abc"
    );
  });

  it("AUTHFLOW: an already-claimed user's unsafe `next` is rejected, falling back to /feed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);

    await expect(InvitePage({ searchParams: searchParams(undefined, "//evil.com") })).rejects.toThrow(
      "REDIRECT:/feed"
    );
  });

  it("2026-07-21 regression: a pre-approved (allowlisted) user landing here post-login also redirects to /feed, not the claim form — hasAccess covers both grant paths", async () => {
    // Before the fix, this page checked hasClaimedInvite directly, which
    // stays false forever for an allowlisted user whose auto-claim only
    // ever ran in the auth callback's no-`next` branch — a user arriving
    // here via `/login?next=/invite` (exactly this page's own redirect)
    // never got auto-claimed, and saw the claim form indefinitely.
    getUserMock.mockResolvedValue({ data: { user: { id: "user-2", email: "allowlisted@example.com" } } });
    hasAccessMock.mockResolvedValue(true);

    await expect(InvitePage({ searchParams: searchParams() })).rejects.toThrow("REDIRECT:/feed");
  });

  it("signed-in without a claimed invite renders the claim form, pre-filled from ?code=", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams("ABC-123") });
    const [form] = result.props.children;
    expect(form.type.name).toBe("InviteForm");
    expect(form.props.initialCode).toBe("ABC-123");
  });

  it("pre-fills an empty code when none was supplied", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams() });
    const [form] = result.props.children;
    expect(form.props.initialCode).toBe("");
  });

  it("AUTHFLOW: passes a sanitized `next` down to InviteForm, so a claim can honor it", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams("ABC-123", "/tailor/abc") });
    const [form] = result.props.children;
    expect(form.props.next).toBe("/tailor/abc");
  });

  it("AUTHFLOW: passes null for `next` down to InviteForm when none was supplied", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams("ABC-123") });
    const [form] = result.props.children;
    expect(form.props.next).toBeNull();
  });

  it("AUTHFLOW: passes null for `next` down to InviteForm when the incoming value is unsafe", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams("ABC-123", "https://evil.com") });
    const [form] = result.props.children;
    expect(form.props.next).toBeNull();
  });

  it("shows the codeless-signup hint alongside the claim form", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);

    const result = await InvitePage({ searchParams: searchParams() });
    const [, hint] = result.props.children;
    expect(hint.props.children).toContain("no code needed");
  });
});
