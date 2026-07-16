import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const hasClaimedInviteMock = vi.fn();
vi.mock("@/lib/db/invites", () => ({ hasClaimedInvite: hasClaimedInviteMock }));

const isAdminMock = vi.fn();
vi.mock("@/lib/admin/isAdmin", () => ({ isAdmin: isAdminMock }));

// extractText.ts is tested directly and thoroughly in extractText.test.ts —
// the route is tested thinly, only for the formData -> extractText wiring
// and the result -> HTTP status mapping (matching this repo's convention,
// e.g. hunt/run/route.test.ts mocks dispatchHunt rather than re-testing it).
const extractTextMock = vi.fn();
vi.mock("@/lib/resume/extractText", () => ({ extractText: extractTextMock }));

const { POST } = await import("./route");

function formDataRequest(file: File | null) {
  const formData = new FormData();
  if (file) formData.append("file", file);
  return new Request("http://localhost/api/resume/extract", { method: "POST", body: formData });
}

describe("POST /api/resume/extract", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasClaimedInviteMock.mockReset();
    isAdminMock.mockReset();
    isAdminMock.mockReturnValue(false);
    extractTextMock.mockReset();
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(formDataRequest(new File(["x"], "resume.pdf")));
    expect(res.status).toBe(401);
    expect(extractTextMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite for a non-admin", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(false);
    const res = await POST(formDataRequest(new File(["x"], "resume.pdf")));
    expect(res.status).toBe(403);
    expect(extractTextMock).not.toHaveBeenCalled();
  });

  it("400s when the file field is absent", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    const res = await POST(formDataRequest(null));
    expect(res.status).toBe(400);
    expect(extractTextMock).not.toHaveBeenCalled();
  });

  it("wires the uploaded file's name and bytes into extractText, and 200s with the extracted text", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    extractTextMock.mockResolvedValue({ ok: true, text: "Alex Quinn — extracted resume text" });

    const file = new File(["%PDF-1.4 fake bytes"], "resume.pdf", { type: "application/pdf" });
    const res = await POST(formDataRequest(file));

    expect(extractTextMock).toHaveBeenCalledTimes(1);
    const [filename, bytes] = extractTextMock.mock.calls[0];
    expect(filename).toBe("resume.pdf");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe("%PDF-1.4 fake bytes");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, text: "Alex Quinn — extracted resume text" });
  });

  it("maps an { ok: false } extraction result to 422, not 400 or 500 — a semantically invalid upload, not a malformed request", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasClaimedInviteMock.mockResolvedValue(true);
    extractTextMock.mockResolvedValue({ ok: false, error: "Couldn't read text in this PDF — paste it instead." });

    const file = new File(["not text"], "resume.pdf", { type: "application/pdf" });
    const res = await POST(formDataRequest(file));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Couldn't read text in this PDF — paste it instead." });
  });
});
