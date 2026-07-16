import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const createSupabaseAdminClientMock = vi.fn(() => ({ __admin: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getOrCreateSessionMock = vi.fn();
const saveSessionMock = vi.fn(async () => {});
vi.mock("@/lib/db/onboardingSession", () => ({
  getOrCreateSession: getOrCreateSessionMock,
  saveSession: saveSessionMock,
}));

const getProfileDocMock = vi.fn();
const upsertProfileDocMock = vi.fn(async (..._args: unknown[]) => ({ status: "valid", errors: [] }));
vi.mock("@/lib/db/profiles", () => ({
  getProfileDoc: getProfileDocMock,
  upsertProfileDoc: upsertProfileDocMock,
}));

const recordOnboardingTurnMock = vi.fn(async () => {});
vi.mock("@/lib/db/ledger", () => ({ recordOnboardingTurn: recordOnboardingTurnMock }));

vi.mock("@/lib/anthropic/client", () => ({ ONBOARDING_MODEL: "claude-sonnet-5" }));

const runVoiceIngestTurnMock = vi.fn();
vi.mock("@/lib/anthropic/moduleTurns", () => ({ runVoiceIngestTurn: runVoiceIngestTurnMock }));

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/modules/voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_SESSION = {
  user_id: "user-1",
  stage: "targeting",
  messages: [],
  extracted: {},
  modules: {},
  status: "in_progress",
};

describe("POST /api/onboarding/modules/voice", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasClaimedInviteMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    getOrCreateSessionMock.mockReset();
    getOrCreateSessionMock.mockResolvedValue(BASE_SESSION);
    saveSessionMock.mockClear();
    getProfileDocMock.mockReset();
    getProfileDocMock.mockResolvedValue(null);
    upsertProfileDocMock.mockClear();
    createSupabaseAdminClientMock.mockClear();
    recordOnboardingTurnMock.mockClear();
    runVoiceIngestTurnMock.mockReset();
    runVoiceIngestTurnMock.mockResolvedValue({
      register: "dry, compressed",
      rhythm: "short declarative sentences",
      words_used: ["ship"],
      words_avoided: ["synergy"],
      signature_phrases: ["I just ship it"],
      usage: { inputTokens: 100, outputTokens: 40 },
    });
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ sample: "I just ship it and move on." }));
    expect(res.status).toBe(401);
    expect(runVoiceIngestTurnMock).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await POST(jsonRequest({ sample: "I just ship it and move on." }));
    expect(res.status).toBe(403);
    expect(runVoiceIngestTurnMock).not.toHaveBeenCalled();
  });

  it("an admin without a claimed invite still succeeds — bypasses the gate", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    isAdminMock.mockReturnValue(true);
    const res = await POST(jsonRequest({ sample: "I just ship it and move on." }));
    expect(res.status).toBe(200);
    expect(hasClaimedInviteMock).not.toHaveBeenCalled();
  });

  it("400s when sample is missing or blank", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ sample: "   " }));
    expect(res.status).toBe(400);
    expect(runVoiceIngestTurnMock).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("happy path: calls the turn, ledgers once, marks voice complete, and saves the session", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(jsonRequest({ sample: "I just ship it and move on." }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.key).toBe("voice");
    expect(typeof body.receipt).toBe("string");
    expect(body.receipt).not.toBe("");

    expect(runVoiceIngestTurnMock).toHaveBeenCalledWith("I just ship it and move on.");
    expect(recordOnboardingTurnMock).toHaveBeenCalledTimes(1);
    expect(recordOnboardingTurnMock).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      model: "claude-sonnet-5",
      inputTokens: 100,
      outputTokens: 40,
    });

    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          voice: expect.objectContaining({
            register: "dry, compressed",
            rhythm: "short declarative sentences",
            words_used: ["ship"],
            words_avoided: ["synergy"],
            signature_phrases: ["I just ship it"],
            sample: "I just ship it and move on.",
          }),
        }),
        modules: expect.objectContaining({ voice: expect.objectContaining({ receipt: expect.any(String) }) }),
      })
    );
  });

  it("skips applyVoiceToDoc/upsertProfileDoc when no profiles row exists yet", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue(null);
    await POST(jsonRequest({ sample: "I just ship it and move on." }));
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
  });

  it("applies to the doc and upserts when a profiles row already exists", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue({ doc: { "voice-profile.md": "" }, validationStatus: null });
    await POST(jsonRequest({ sample: "I just ship it and move on." }));
    expect(upsertProfileDocMock).toHaveBeenCalledTimes(1);
    const [, , doc] = upsertProfileDocMock.mock.calls[0];
    expect((doc as Record<string, string>)["voice-profile.md"]).toContain("I just ship it");
  });

  it("drops a fabricated signature_phrase that never appears in the sample", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    runVoiceIngestTurnMock.mockResolvedValue({
      register: "dry, compressed",
      rhythm: "short declarative sentences",
      words_used: ["ship"],
      words_avoided: ["synergy"],
      // "I just ship it" is a real substring of the sample below; the second
      // phrase is fabricated (not present anywhere in the sample) and must
      // be dropped by the route's verbatim filter, not merely truncated or
      // deduped by some other check.
      signature_phrases: ["I just ship it", "we synergize deliverables cross-functionally"],
      usage: { inputTokens: 100, outputTokens: 40 },
    });
    await POST(jsonRequest({ sample: "I just ship it and move on." }));
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          voice: expect.objectContaining({ signature_phrases: ["I just ship it"] }),
        }),
      })
    );
  });
});
