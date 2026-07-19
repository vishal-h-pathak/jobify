import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn(async () => ({ data: { user: null } }));
const createServerClientMock = vi.fn(() => ({ auth: { getUser: getUserMock } }));

vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }));

const { updateSession } = await import("./updateSession");

describe("updateSession", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    createServerClientMock.mockClear();
  });

  it("forwards the request pathname as an x-pathname header, so a Server Component layout can read it", async () => {
    const request = new NextRequest("https://example.com/onboarding/anchor");

    const response = await updateSession(request);

    expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/onboarding/anchor");
  });

  it("still refreshes the session by calling auth.getUser() exactly once", async () => {
    const request = new NextRequest("https://example.com/feed");

    await updateSession(request);

    expect(getUserMock).toHaveBeenCalledTimes(1);
  });
});
