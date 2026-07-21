import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

const getOrCreateSessionMock = vi.fn();
const saveSessionMock = vi.fn(async (..._args: unknown[]) => {});
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

const { POST } = await import("./route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/onboarding/modules/mirror/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DRAFT = {
  paragraphs: ["Draft paragraph one.", "Draft paragraph two."],
  quoted_phrases: ["ship things quickly", "see what breaks"],
};

const BASE_SESSION = {
  user_id: "user-1",
  stage: "targeting",
  messages: [],
  extracted: { mirror_draft: DRAFT },
  modules: {},
  status: "in_progress",
};

describe("POST /api/onboarding/modules/mirror/accept", () => {
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
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ paragraphs: ["a", "b"] }));
    expect(res.status).toBe(401);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await POST(jsonRequest({ paragraphs: ["a", "b"] }));
    expect(res.status).toBe(403);
  });

  it("400s when paragraphs isn't exactly two non-empty strings", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    for (const bad of [undefined, [], ["only one"], ["a", "b", "c"], ["", "b"], ["a", "   "], ["a", 2]]) {
      const res = await POST(jsonRequest({ paragraphs: bad }));
      expect(res.status).toBe(400);
    }
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it("happy path: uses the client-submitted (edited) paragraphs, not the stored draft's paragraphs", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const editedParagraphs = ["An edited first paragraph, rewritten by the candidate.", "An edited second paragraph."];

    const res = await POST(jsonRequest({ paragraphs: editedParagraphs }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.key).toBe("mirror");
    expect(typeof body.receipt).toBe("string");

    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        extracted: expect.objectContaining({
          mirror: { paragraphs: editedParagraphs, quoted_phrases: DRAFT.quoted_phrases },
        }),
        modules: expect.objectContaining({ mirror: expect.objectContaining({ receipt: expect.any(String) }) }),
        status: "complete",
      })
    );
  });

  it("quoted_phrases in the stored/receipt record come from the last mirror_draft, not from the client body", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    // Client submits paragraphs plus (ignored) extra fields — quoted_phrases
    // is never accepted from the request body per the route's contract.
    await POST(jsonRequest({ paragraphs: ["Edited one.", "Edited two."], quoted_phrases: ["should be ignored"] }));
    const [, , update] = saveSessionMock.mock.calls[0];
    expect((update as { extracted: { mirror: { quoted_phrases: string[] } } }).extracted.mirror.quoted_phrases).toEqual(
      DRAFT.quoted_phrases
    );
  });

  it("falls back to an empty quoted_phrases list when there is no mirror_draft at all", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getOrCreateSessionMock.mockResolvedValue({ ...BASE_SESSION, extracted: {} });
    await POST(jsonRequest({ paragraphs: ["Edited one.", "Edited two."] }));
    const [, , update] = saveSessionMock.mock.calls[0];
    expect((update as { extracted: { mirror: { quoted_phrases: string[] } } }).extracted.mirror.quoted_phrases).toEqual([]);
  });

  it("skips applying to the doc when no profiles row exists yet", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue(null);
    await POST(jsonRequest({ paragraphs: ["Edited one.", "Edited two."] }));
    expect(upsertProfileDocMock).not.toHaveBeenCalled();
  });

  it("replaces thesis.md's intro with the accepted paragraphs and upserts when a profiles row exists", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    getProfileDocMock.mockResolvedValue({
      doc: { "thesis.md": "# Hunting thesis\n\nOld intro.\n\n## Targeting\n\nSome section body.\n" },
      validationStatus: null,
    });
    await POST(jsonRequest({ paragraphs: ["Edited one.", "Edited two."] }));
    expect(upsertProfileDocMock).toHaveBeenCalledTimes(1);
    const [, , doc] = upsertProfileDocMock.mock.calls[0];
    const thesis = (doc as Record<string, string>)["thesis.md"];
    expect(thesis).toContain("Edited one.");
    expect(thesis).toContain("Edited two.");
    expect(thesis).toContain("## Targeting");
    expect(thesis).toContain("Some section body.");
    expect(thesis).not.toContain("Old intro.");
  });
});
