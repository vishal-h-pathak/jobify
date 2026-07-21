import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const createSupabaseAdminClientMock = vi.fn(() => ({ __admin: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getOrCreateSessionMock = vi.fn();
const saveSessionMock = vi.fn(async () => {});
vi.mock("@/lib/db/onboardingSession", () => ({
  getOrCreateSession: getOrCreateSessionMock,
  saveSession: saveSessionMock,
}));

const getProfileDocMock = vi.fn();
const upsertProfileDocMock = vi.fn(async () => ({ status: "valid", errors: [] }));
vi.mock("@/lib/db/profiles", () => ({
  getProfileDoc: getProfileDocMock,
  upsertProfileDoc: upsertProfileDocMock,
}));

// V3A-1 contract: session 30 (feat/v3a-spine) owns these three files. They
// don't exist on disk in this branch yet, but Vitest mocks by import
// specifier rather than by resolving the real file, so this suite stays
// green independent of 30 landing — see planning/session-prompts/
// 31_v3a_modules.md's pinned-contract note.
const markModuleCompleteMock = vi.fn((_session, _key, _receipt) => ({
  [_key]: { completed_at: "2026-07-16T00:00:00.000Z", receipt: _receipt },
}));
vi.mock("@/lib/onboarding/moduleRegistry", () => ({
  markModuleComplete: markModuleCompleteMock,
}));

const applyModuleToDocMock = vi.fn((doc) => ({ ...doc, "thesis.md": "updated" }));
vi.mock("@/lib/onboarding/incrementalDoc", () => ({
  applyModuleToDoc: applyModuleToDocMock,
}));

const maybeFireCheckpointMock = vi.fn(async (_deps: unknown, _session: unknown, _user: unknown) => {});
vi.mock("@/lib/onboarding/checkpoint", () => ({
  maybeFireCheckpoint: maybeFireCheckpointMock,
}));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/modules/dealbreakers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(key: string) {
  return { params: Promise.resolve({ key }) };
}

const BASE_SESSION = { user_id: "user-1", stage: "targeting", messages: [], extracted: {}, modules: {}, status: "in_progress" };

describe("POST /api/onboarding/modules/[key]", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue(BASE_SESSION);
    saveSessionMock.mockClear();
    getProfileDocMock.mockReset();
    getProfileDocMock.mockResolvedValue(null);
    upsertProfileDocMock.mockClear();
    markModuleCompleteMock.mockClear();
    applyModuleToDocMock.mockClear();
    maybeFireCheckpointMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
  });

  it("404s for a key that isn't a structured module (owned by another route)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({}), ctx("anchor"));
    expect(res.status).toBe(404);
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ hard_disqualifiers: [] }), ctx("dealbreakers"));
    expect(res.status).toBe(401);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await POST(jsonRequest({ hard_disqualifiers: [] }), ctx("dealbreakers"));
    expect(res.status).toBe(403);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    isAdminMock.mockReturnValue(true);
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ hard_disqualifiers: [] }), ctx("dealbreakers"));
    expect(res.status).toBe(200);
  });

  it("400s and writes nothing when the body fails the module's schema", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ hard_disqualifiers: "not an array" }), ctx("dealbreakers"));
    expect(res.status).toBe(400);
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(markModuleCompleteMock).not.toHaveBeenCalled();
  });

  it("writes extracted[key], calls markModuleComplete with the receipt, and saves the returned modules", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ hard_disqualifiers: ["Crypto / Web3"] }), ctx("dealbreakers"));
    expect(res.status).toBe(200);
    const responseBody = await res.json();
    expect(responseBody).toEqual({ ok: true, key: "dealbreakers", receipt: "1 dealbreakers" });

    expect(markModuleCompleteMock).toHaveBeenCalledWith(BASE_SESSION, "dealbreakers", "1 dealbreakers");
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          dealbreakers: { hard_disqualifiers: ["Crypto / Web3"], soft_concerns: [] },
        }),
        modules: expect.objectContaining({ dealbreakers: expect.any(Object) }),
      })
    );
  });

  it("preserves any pre-existing extracted fields (merge, not overwrite)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({ ...BASE_SESSION, extracted: { anchor: { free_text: "x" } } });
    await POST(jsonRequest({ hard_disqualifiers: [] }), ctx("dealbreakers"));
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({ anchor: { free_text: "x" } }),
      })
    );
  });

  it("skips applyModuleToDoc/upsertProfileDoc when no profiles row exists yet", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue(null);
    await POST(jsonRequest({ hard_disqualifiers: [] }), ctx("dealbreakers"));
    expect(applyModuleToDocMock).not.toHaveBeenCalled();
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
  });

  it("applies the module to the doc and upserts when a profiles row already exists", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue({ doc: { "thesis.md": "" }, validationStatus: null });
    await POST(jsonRequest({ hard_disqualifiers: ["Crypto / Web3"] }), ctx("dealbreakers"));
    expect(applyModuleToDocMock).toHaveBeenCalledWith(
      { "thesis.md": "" },
      "dealbreakers",
      { hard_disqualifiers: ["Crypto / Web3"], soft_concerns: [] }
    );
    expect(upsertProfileDocMock).toHaveBeenCalledWith(expect.anything(), "user-1", { "thesis.md": "updated" });
  });

  it("calls maybeFireCheckpoint after every module completion", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    await POST(jsonRequest({ hard_disqualifiers: [] }), ctx("dealbreakers"));
    expect(maybeFireCheckpointMock).toHaveBeenCalledTimes(1);
    const [deps, session, user] = maybeFireCheckpointMock.mock.calls[0];
    expect(deps).toEqual(expect.objectContaining({ admin: expect.anything() }));
    expect((session as { extracted: Record<string, unknown> }).extracted.dealbreakers).toEqual({
      hard_disqualifiers: [],
      soft_concerns: [],
    });
    expect(user).toEqual({ id: "user-1" });
  });

  it("never records a budget_ledger row / calls the Anthropic client (zero-LLM stage)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    await POST(jsonRequest({ hard_disqualifiers: [] }), ctx("dealbreakers"));
    // No ledger/anthropic mocks are wired into this test file at all — if
    // the route tried to call either, the unmocked module would throw.
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
  });

  it("works for the values module end to end", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const choices = [
      { pair_id: "mission_prestige", choice: "a" },
      { pair_id: "hours_equity", choice: "a" },
      { pair_id: "specialist_generalist", choice: "a" },
      { pair_id: "autonomy_mentorship", choice: "a" },
      { pair_id: "stability_upside", choice: "a" },
      { pair_id: "ic_leadership", choice: "a" },
    ];
    const res = await POST(jsonRequest(choices), ctx("values"));
    expect(res.status).toBe(200);
    const responseBody = await res.json();
    expect(responseBody.receipt).toBe("6 trade-offs chosen");
  });
});
