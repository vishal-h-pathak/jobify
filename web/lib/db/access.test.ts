import { describe, expect, it, vi, beforeEach } from "vitest";

const hasClaimedInviteMock = vi.fn();
const consumeAllowlistedEmailMock = vi.fn();
const isAdminMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn(() => "admin-client");

vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));
vi.mock("@/lib/db/allowlist", () => ({ consumeAllowlistedEmail: consumeAllowlistedEmailMock }));
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

const { hasAccess } = await import("./access");

const supabase = "fake-supabase" as never;
const user = { id: "user-1", email: "u@example.com" } as never;

describe("hasAccess — the unified account-level predicate", () => {
  beforeEach(() => {
    hasClaimedInviteMock.mockReset();
    consumeAllowlistedEmailMock.mockReset();
    isAdminMock.mockReset();
    createSupabaseAdminClientMock.mockClear();
  });

  it("is true for admins, without touching the invite or allowlist tables", async () => {
    isAdminMock.mockReturnValue(true);

    expect(await hasAccess(supabase, user)).toBe(true);
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
    expect(consumeAllowlistedEmailMock).not.toHaveBeenCalled();
  });

  it("is true for a user who already holds a claimed invite, without checking the allowlist", async () => {
    isAdminMock.mockReturnValue(false);
    hasClaimedInviteMock.mockResolvedValue(true);

    expect(await hasAccess(supabase, user)).toBe(true);
    expect(consumeAllowlistedEmailMock).not.toHaveBeenCalled();
  });

  it("is true for an allowlisted user with no claimed invite yet — the auto-claim runs right here", async () => {
    isAdminMock.mockReturnValue(false);
    hasClaimedInviteMock.mockResolvedValue(false);
    consumeAllowlistedEmailMock.mockResolvedValue(true);

    expect(await hasAccess(supabase, user)).toBe(true);
    expect(consumeAllowlistedEmailMock).toHaveBeenCalledWith("admin-client", user);
  });

  it("is false for a user who is neither claimed, allowlisted, nor admin", async () => {
    isAdminMock.mockReturnValue(false);
    hasClaimedInviteMock.mockResolvedValue(false);
    consumeAllowlistedEmailMock.mockResolvedValue(false);

    expect(await hasAccess(supabase, user)).toBe(false);
  });

  it("re-checking after the allowlist row is consumed costs one wasted SELECT, not a false negative", async () => {
    isAdminMock.mockReturnValue(false);
    hasClaimedInviteMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    consumeAllowlistedEmailMock.mockResolvedValueOnce(true);

    expect(await hasAccess(supabase, user)).toBe(true);
    expect(await hasAccess(supabase, user)).toBe(true);
    // second call short-circuits on hasClaimedInvite now being true
    expect(consumeAllowlistedEmailMock).toHaveBeenCalledTimes(1);
  });
});
