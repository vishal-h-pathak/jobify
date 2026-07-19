import { describe, expect, it, vi } from "vitest";
import { intakeComplete } from "./intakeComplete";

function fakeSupabase(row: { status: string } | null, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data: row, error }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, from, select, eq, maybeSingle };
}

describe("intakeComplete", () => {
  it("returns false when the user has no onboarding_sessions row yet", async () => {
    const { client } = fakeSupabase(null);

    await expect(intakeComplete(client, "user-1")).resolves.toBe(false);
  });

  it("returns false when the session is still in_progress", async () => {
    const { client } = fakeSupabase({ status: "in_progress" });

    await expect(intakeComplete(client, "user-1")).resolves.toBe(false);
  });

  it("returns true when the session status is complete", async () => {
    const { client } = fakeSupabase({ status: "complete" });

    await expect(intakeComplete(client, "user-1")).resolves.toBe(true);
  });

  it("scopes the query to the given user_id and reads the onboarding_sessions table", async () => {
    const { client, from, select, eq } = fakeSupabase({ status: "complete" });

    await intakeComplete(client, "user-42");

    expect(from).toHaveBeenCalledWith("onboarding_sessions");
    expect(select).toHaveBeenCalledWith("status");
    expect(eq).toHaveBeenCalledWith("user_id", "user-42");
  });

  it("throws when the query errors", async () => {
    const { client } = fakeSupabase(null, new Error("boom"));

    await expect(intakeComplete(client, "user-1")).rejects.toThrow("boom");
  });
});
