import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const { default: TailorPage } = await import("./page");

function params(runId: string) {
  return Promise.resolve({ runId });
}
function searchParams(posting?: string) {
  return Promise.resolve(posting !== undefined ? { posting } : {});
}

describe("/tailor/[runId] page", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    redirectMock.mockClear();
  });

  it("signed-out visitors redirect to /login, preserving the destination", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(
      TailorPage({ params: params("run-1"), searchParams: searchParams("posting-1") })
    ).rejects.toThrow("REDIRECT:/login?next=%2Ftailor%2Frun-1%3Fposting%3Dposting-1");
  });

  it("signed-in with both runId and posting renders the viewer with both ids", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const result = await TailorPage({ params: params("run-1"), searchParams: searchParams("posting-1") });
    expect(result.type.name).toBe("TailorViewer");
    expect(result.props.runId).toBe("run-1");
    expect(result.props.postingId).toBe("posting-1");
  });

  it("signed-in with no posting search param renders the missing-context empty state, not the viewer", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const result = await TailorPage({ params: params("run-1"), searchParams: searchParams() });
    expect(result.type.name).not.toBe("TailorViewer");
  });
});
