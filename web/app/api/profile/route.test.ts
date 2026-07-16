import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const sessionSelectResult = { data: null as unknown, error: null as unknown };
const sessionUpdateCalls: Array<Record<string, unknown>> = [];

function fakeSupabase() {
  return {
    auth: { getUser: getUserMock },
    from(table: string) {
      if (table !== "onboarding_sessions") throw new Error(`unexpected table ${table}`);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => Promise.resolve(sessionSelectResult);
      chain.update = (values: Record<string, unknown>) => {
        sessionUpdateCalls.push(values);
        return chain;
      };
      // update(...).eq(...) resolves the write
      chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeSupabase()),
}));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getProfileDocMock = vi.fn();
const upsertProfileDocMock = vi.fn(
  async (_supabase: unknown, _userId: string, _doc: Record<string, string>) => ({ status: "valid", errors: [] })
);
vi.mock("@/lib/db/profiles", () => ({
  getProfileDoc: getProfileDocMock,
  upsertProfileDoc: upsertProfileDocMock,
}));

const { PATCH } = await import("./route");

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/profile", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasClaimedInviteMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getProfileDocMock.mockReset();
    getProfileDocMock.mockResolvedValue({
      doc: { "profile.yml": "identity:\n  name: Alex Quinn\n  email: alex@example.com\n" },
      validationStatus: { status: "valid", errors: [] },
    });
    upsertProfileDocMock.mockClear();
    sessionSelectResult.data = { extracted: {} };
    sessionSelectResult.error = null;
    sessionUpdateCalls.length = 0;
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(patchRequest({ base: "Atlanta, GA" }));
    expect(res.status).toBe(401);
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await PATCH(patchRequest({ base: "Atlanta, GA" }));
    expect(res.status).toBe(403);
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    isAdminMock.mockReturnValue(true);
    const res = await PATCH(patchRequest({ base: "Atlanta, GA" }));
    expect(res.status).toBe(200);
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("400s when no editable field is provided", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await PATCH(patchRequest({ base: "   " }));
    expect(res.status).toBe(400);
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
  });

  it("404s when the user hasn't finished onboarding yet (no profiles row)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ base: "Atlanta, GA" }));
    expect(res.status).toBe(404);
  });

  it("merges the patch into extracted.identity.location_and_compensation, writes the session, and revalidates the doc", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    sessionSelectResult.data = {
      extracted: { identity: { name: "Alex Quinn", location_and_compensation: { current_comp_usd: 165000 } } },
    };

    const res = await PATCH(patchRequest({ base: "Atlanta, GA", remote_acceptable: true, target_comp_usd: "180000+" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, validation: { status: "valid", errors: [] } });
    expect(sessionUpdateCalls).toHaveLength(1);
    expect(sessionUpdateCalls[0].extracted).toEqual({
      identity: {
        name: "Alex Quinn",
        location_and_compensation: {
          current_comp_usd: 165000,
          base: "Atlanta, GA",
          remote_acceptable: true,
          target_comp_usd: "180000+",
        },
      },
    });

    expect(upsertProfileDocMock).toHaveBeenCalledTimes(1);
    const [, , writtenDoc] = upsertProfileDocMock.mock.calls[0];
    expect(writtenDoc["profile.yml"]).toContain("Atlanta, GA");
  });

  it("ignores a missing onboarding_sessions row rather than crashing", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    sessionSelectResult.data = null;

    const res = await PATCH(patchRequest({ base: "Atlanta, GA" }));

    expect(res.status).toBe(200);
    expect(sessionUpdateCalls[0].extracted).toEqual({
      identity: { location_and_compensation: { base: "Atlanta, GA" } },
    });
  });
});
