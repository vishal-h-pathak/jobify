import { describe, expect, it, vi } from "vitest";
import { dispatchHunt } from "./dispatchHunt";

const FIXED_NOW = new Date("2026-07-05T12:00:00.000Z");

function fakeAdmin(profileRow: Record<string, unknown> | null) {
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const admin = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: profileRow, error: null })),
        })),
      })),
      update,
    })),
  };
  return { admin, update };
}

function baseDeps(overrides: Partial<Parameters<typeof dispatchHunt>[0]> = {}) {
  return {
    admin: fakeAdmin({ user_id: "user-1", validation_status: null, last_hunt_requested_at: null }).admin as never,
    targetUserId: "user-1",
    bypassCooldown: false,
    cooldownHours: 6,
    githubRepo: "acme/jobify",
    githubToken: "gh-secret-token",
    fetchImpl: vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

describe("dispatchHunt", () => {
  it("returns no_profile when the target user has no profiles row", async () => {
    const { admin } = fakeAdmin(null);
    const result = await dispatchHunt(baseDeps({ admin: admin as never }));
    expect(result).toEqual({ kind: "no_profile" });
  });

  it("returns invalid_profile when validation_status is invalid", async () => {
    const { admin } = fakeAdmin({
      user_id: "user-1",
      validation_status: { status: "invalid", errors: ["bad"] },
      last_hunt_requested_at: null,
    });
    const result = await dispatchHunt(baseDeps({ admin: admin as never }));
    expect(result).toEqual({ kind: "invalid_profile" });
  });

  it("returns cooldown with the correct cooldown_until when still within the window", async () => {
    const lastRequested = "2026-07-05T08:00:00.000Z"; // + 6h = 14:00, now is 12:00
    const { admin } = fakeAdmin({
      user_id: "user-1",
      validation_status: null,
      last_hunt_requested_at: lastRequested,
    });
    const result = await dispatchHunt(baseDeps({ admin: admin as never }));
    expect(result).toEqual({ kind: "cooldown", cooldownUntil: "2026-07-05T14:00:00.000Z" });
  });

  it("dispatches once the cooldown window has elapsed", async () => {
    const lastRequested = "2026-07-05T02:00:00.000Z"; // + 6h = 08:00, now is 12:00 -> elapsed
    const { admin, update } = fakeAdmin({
      user_id: "user-1",
      validation_status: null,
      last_hunt_requested_at: lastRequested,
    });
    const result = await dispatchHunt(baseDeps({ admin: admin as never }));
    expect(result).toEqual({ kind: "ok", cooldownUntil: "2026-07-05T18:00:00.000Z" });
    expect(update).toHaveBeenCalledWith({ last_hunt_requested_at: FIXED_NOW.toISOString() });
  });

  it("admins bypass an active cooldown", async () => {
    const lastRequested = "2026-07-05T11:00:00.000Z"; // + 6h = 17:00, now is 12:00 -> still active
    const { admin } = fakeAdmin({
      user_id: "user-1",
      validation_status: null,
      last_hunt_requested_at: lastRequested,
    });
    const result = await dispatchHunt(baseDeps({ admin: admin as never, bypassCooldown: true }));
    expect(result.kind).toBe("ok");
  });

  it("systemInitiated skips an active cooldown, same as bypassCooldown", async () => {
    const lastRequested = "2026-07-05T11:00:00.000Z"; // + 6h = 17:00, now is 12:00 -> still active
    const { admin } = fakeAdmin({
      user_id: "user-1",
      validation_status: null,
      last_hunt_requested_at: lastRequested,
    });
    const result = await dispatchHunt(baseDeps({ admin: admin as never, systemInitiated: true }));
    expect(result.kind).toBe("ok");
  });

  it("systemInitiated still stamps last_hunt_requested_at on success", async () => {
    const lastRequested = "2026-07-05T11:00:00.000Z";
    const { admin, update } = fakeAdmin({
      user_id: "user-1",
      validation_status: null,
      last_hunt_requested_at: lastRequested,
    });
    await dispatchHunt(baseDeps({ admin: admin as never, systemInitiated: true }));
    expect(update).toHaveBeenCalledWith({ last_hunt_requested_at: FIXED_NOW.toISOString() });
  });

  it("the default path (no systemInitiated, no bypassCooldown) is unchanged: cooldown still applies", async () => {
    const lastRequested = "2026-07-05T11:00:00.000Z"; // + 6h = 17:00, now is 12:00 -> still active
    const { admin } = fakeAdmin({
      user_id: "user-1",
      validation_status: null,
      last_hunt_requested_at: lastRequested,
    });
    const result = await dispatchHunt(baseDeps({ admin: admin as never }));
    expect(result).toEqual({ kind: "cooldown", cooldownUntil: "2026-07-05T17:00:00.000Z" });
  });

  it("returns not_configured when GitHub env vars are missing, without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await dispatchHunt(baseDeps({ githubRepo: undefined, fetchImpl: fetchImpl as never }));
    expect(result).toEqual({ kind: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dispatches with the exact documented payload shape and never leaks the token in the result", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await dispatchHunt(baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/jobify/actions/workflows/hosted-hunt.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer gh-secret-token",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main", inputs: { user_id: "user-1" } }),
      }
    );
    expect(JSON.stringify(result)).not.toContain("gh-secret-token");
  });

  it("returns dispatch_failed with the upstream status when GitHub doesn't return 204", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const result = await dispatchHunt(baseDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(result).toEqual({ kind: "dispatch_failed", status: 401 });
    expect(JSON.stringify(result)).not.toContain("gh-secret-token");
  });
});
