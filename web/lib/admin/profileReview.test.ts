import { describe, expect, it } from "vitest";
import { getUserProfileReview } from "./profileReview";

function chainable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

function fakeAdmin(opts: {
  session?: { data: unknown; error: unknown };
  profile?: { data: unknown; error: unknown };
}) {
  const tables: Record<string, unknown> = {
    onboarding_sessions: chainable(opts.session ?? { data: null, error: null }),
    profiles: chainable(opts.profile ?? { data: null, error: null }),
  };
  return { from: (table: string) => tables[table] } as never;
}

describe("getUserProfileReview", () => {
  it("returns an empty-but-shaped review when neither row exists yet", async () => {
    const admin = fakeAdmin({});
    const review = await getUserProfileReview(admin, "user-1");
    expect(review).toEqual({ extracted: {}, doc: null, validationStatus: null });
  });

  it("assembles extracted + doc + validationStatus from both tables (renders from a fake)", async () => {
    const admin = fakeAdmin({
      session: { data: { extracted: { anchor: { current_title: "Engineer" } } }, error: null },
      profile: {
        data: { doc: { "cv.md": "hello", "thesis.md": "" }, validation_status: { status: "valid", errors: [] } },
        error: null,
      },
    });
    const review = await getUserProfileReview(admin, "user-1");
    expect(review).toEqual({
      extracted: { anchor: { current_title: "Engineer" } },
      doc: { "cv.md": "hello", "thesis.md": "" },
      validationStatus: { status: "valid", errors: [] },
    });
  });

  it("throws if the onboarding_sessions read errors", async () => {
    const admin = fakeAdmin({ session: { data: null, error: new Error("boom") } });
    await expect(getUserProfileReview(admin, "user-1")).rejects.toThrow("boom");
  });

  it("throws if the profiles read errors", async () => {
    const admin = fakeAdmin({ profile: { data: null, error: new Error("boom") } });
    await expect(getUserProfileReview(admin, "user-1")).rejects.toThrow("boom");
  });
});
