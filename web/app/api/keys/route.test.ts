import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const fakeSupabase = { auth: { getUser: getUserMock } };
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeSupabase),
}));

const hasAccessMock = vi.fn();
vi.mock("@/lib/db/access", () => ({ hasAccess: hasAccessMock }));

const saveApiKeyMock = vi.fn(async () => {});
const deleteApiKeyMock = vi.fn(async () => {});
vi.mock("@/lib/db/keys", () => ({
  saveApiKey: saveApiKeyMock,
  deleteApiKey: deleteApiKeyMock,
  looksLikeAnthropicKey: (v: string) => v.startsWith("sk-ant-") && v.length >= 20,
}));

const routeModule = await import("./route");
// Next's route-handler type augmentation widens POST/DELETE's inferred
// return type to include `undefined`; both always return a NextResponse
// in practice (see route.ts), so the test helpers assert that directly.
async function callPost(request: Request): Promise<Response> {
  const res = await routeModule.POST(request);
  if (!res) throw new Error("POST returned no response");
  return res;
}
async function callDelete(): Promise<Response> {
  const res = await routeModule.DELETE();
  if (!res) throw new Error("DELETE returned no response");
  return res;
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/keys", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    saveApiKeyMock.mockClear();
  });

  it("401s when not signed in — never touches saveApiKey", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await callPost(jsonRequest({ key: "sk-ant-abcdefghijklmnop" }));
    expect(res.status).toBe(401);
    expect(saveApiKeyMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite — the (app) layout gates pages only, not this route", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await callPost(jsonRequest({ key: "sk-ant-abcdefghijklmnop" }));
    expect(res.status).toBe(403);
    expect(saveApiKeyMock).not.toHaveBeenCalled();
  });

  it("400s on a key that doesn't look like an Anthropic key", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await callPost(jsonRequest({ key: "not-a-key" }));
    expect(res.status).toBe(400);
    expect(saveApiKeyMock).not.toHaveBeenCalled();
  });

  it("saves the key and the response body only ever contains last4, never the plaintext", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await callPost(jsonRequest({ key: "sk-ant-abcdefghijklmnop" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, keyLast4: "mnop" });
    expect(JSON.stringify(body)).not.toContain("sk-ant-abcdefghijklmnop");
    expect(saveApiKeyMock).toHaveBeenCalledWith(fakeSupabase, "user-1", "sk-ant-abcdefghijklmnop");
  });
});

describe("DELETE /api/keys", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    hasAccessMock.mockReset();
    deleteApiKeyMock.mockClear();
  });

  it("401s when not signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await callDelete();
    expect(res.status).toBe(401);
    expect(deleteApiKeyMock).not.toHaveBeenCalled();
  });

  it("403s without a claimed invite", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(false);
    const res = await callDelete();
    expect(res.status).toBe(403);
    expect(deleteApiKeyMock).not.toHaveBeenCalled();
  });

  it("removes the signed-in user's key", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    hasAccessMock.mockResolvedValue(true);
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(deleteApiKeyMock).toHaveBeenCalledWith(fakeSupabase, "user-1");
  });
});
