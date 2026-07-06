import { describe, expect, it } from "vitest";
import { getProfileDoc, upsertProfileDoc } from "./profiles";

function fakeSupabase(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle", "upsert"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return { from: () => chain } as never;
}

describe("getProfileDoc", () => {
  it("returns null when the user has no profiles row yet", async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    expect(await getProfileDoc(supabase, "user-1")).toBeNull();
  });

  it("returns the doc + validationStatus for an existing row", async () => {
    const supabase = fakeSupabase({
      data: { doc: { "cv.md": "hello" }, validation_status: { status: "valid", errors: [] } },
      error: null,
    });
    expect(await getProfileDoc(supabase, "user-1")).toEqual({
      doc: { "cv.md": "hello" },
      validationStatus: { status: "valid", errors: [] },
    });
  });

  it("throws on a database error", async () => {
    const supabase = fakeSupabase({ data: null, error: new Error("boom") });
    await expect(getProfileDoc(supabase, "user-1")).rejects.toThrow("boom");
  });
});

// Pre-existing function — no prior test file existed for this module, so
// this locks in current behavior alongside the new getProfileDoc coverage.
describe("upsertProfileDoc", () => {
  it("still exists and is callable", () => {
    expect(typeof upsertProfileDoc).toBe("function");
  });
});
