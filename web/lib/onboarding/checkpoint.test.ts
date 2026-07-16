import { describe, expect, it, vi } from "vitest";
import { maybeFireCheckpoint, type CheckpointDeps } from "./checkpoint";
import type { ModulesState } from "./moduleRegistry";
import type { Database } from "../supabase/types";

type SessionRow = Database["public"]["Tables"]["onboarding_sessions"]["Row"];

const PHASE_ONE_MODULES: ModulesState = {
  anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "Engineer · Acme" },
  reactions: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "6 reactions (4 interested)" },
  values: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "3 trade-offs answered" },
  dealbreakers: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "1 hard constraint" },
};

function baseSession(modules: ModulesState): SessionRow {
  return {
    user_id: "user-1",
    stage: "done",
    messages: [],
    extracted: {
      anchor: { current_title: "Engineer", current_company: "Acme" },
      dealbreakers: { hard_disqualifiers: ["Crypto"] },
    },
    modules,
    status: "in_progress",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

/** A fake `profiles` table that actually tracks upserted state across calls,
 * so the "no profiles row exists" idempotency guard can be exercised the
 * same way it behaves against real Postgres. */
function fakeAdmin() {
  let profilesRow: Record<string, unknown> | null = null;
  const sessionUpdates: Array<Record<string, unknown>> = [];
  const upsert = vi.fn(async (row: Record<string, unknown>) => {
    profilesRow = row;
    return { error: null };
  });
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: profilesRow, error: null })),
            })),
          })),
          upsert,
        };
      }
      if (table === "onboarding_sessions") {
        return {
          update: vi.fn((update: Record<string, unknown>) => ({
            eq: vi.fn(async () => {
              sessionUpdates.push(update);
              return { error: null };
            }),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { admin, upsert, sessionUpdates, getProfilesRow: () => profilesRow };
}

function baseDeps(admin: unknown, overrides: Partial<CheckpointDeps> = {}): CheckpointDeps {
  return {
    admin: admin as CheckpointDeps["admin"],
    dispatchHunt: vi.fn(async () => ({ kind: "ok" as const, cooldownUntil: "2026-01-01T06:00:00.000Z" })),
    cooldownHours: 6,
    githubRepo: "acme/jobify",
    githubToken: "gh-secret",
    fetchImpl: vi.fn() as unknown as typeof fetch,
    now: () => new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

describe("maybeFireCheckpoint", () => {
  it("does nothing when phase 1 isn't complete", async () => {
    const { admin, upsert } = fakeAdmin();
    const deps = baseDeps(admin);
    await maybeFireCheckpoint(deps, baseSession({ anchor: PHASE_ONE_MODULES.anchor }), {
      id: "user-1",
      email: "alex@example.com",
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(deps.dispatchHunt).not.toHaveBeenCalled();
  });

  it("fires once phase 1 completes: builds+upserts the doc, dispatches with systemInitiated, stamps checkpoint_hunt", async () => {
    const { admin, upsert, sessionUpdates } = fakeAdmin();
    const deps = baseDeps(admin);
    await maybeFireCheckpoint(deps, baseSession(PHASE_ONE_MODULES), { id: "user-1", email: "alex@example.com" });

    expect(upsert).toHaveBeenCalledTimes(1);
    const [{ user_id, doc }] = upsert.mock.calls[0] as [{ user_id: string; doc: Record<string, string> }];
    expect(user_id).toBe("user-1");
    expect(doc["profile.yml"]).toContain("alex@example.com");

    expect(deps.dispatchHunt).toHaveBeenCalledTimes(1);
    expect(deps.dispatchHunt).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: "user-1", systemInitiated: true, bypassCooldown: false })
    );

    expect(sessionUpdates).toHaveLength(1);
    const modulesUpdate = sessionUpdates[0].modules as ModulesState;
    expect(modulesUpdate.checkpoint_hunt?.fired_at).toBe("2026-01-02T00:00:00.000Z");
    expect(modulesUpdate.anchor).toEqual(PHASE_ONE_MODULES.anchor); // other modules untouched
  });

  it("is exactly-once under repeat calls, even with the same stale in-memory session", async () => {
    const { admin, upsert } = fakeAdmin();
    const deps = baseDeps(admin);
    const session = baseSession(PHASE_ONE_MODULES); // no checkpoint_hunt yet — simulates a stale read

    await maybeFireCheckpoint(deps, session, { id: "user-1", email: "alex@example.com" });
    await maybeFireCheckpoint(deps, session, { id: "user-1", email: "alex@example.com" });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(deps.dispatchHunt).toHaveBeenCalledTimes(1);
  });

  it("does nothing when checkpoint_hunt is already stamped on the session", async () => {
    const { admin, upsert } = fakeAdmin();
    const deps = baseDeps(admin);
    const session = baseSession({ ...PHASE_ONE_MODULES, checkpoint_hunt: { fired_at: "2026-01-01T12:00:00.000Z" } });
    await maybeFireCheckpoint(deps, session, { id: "user-1", email: "alex@example.com" });
    expect(upsert).not.toHaveBeenCalled();
    expect(deps.dispatchHunt).not.toHaveBeenCalled();
  });

  it("is failure-safe: a thrown error from the upsert is caught, logged, and never propagates", async () => {
    const { admin } = fakeAdmin();
    const failingAdmin = {
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
            })),
            upsert: vi.fn(async () => ({ error: new Error("boom") })),
          };
        }
        return (admin as { from: (t: string) => unknown }).from(table);
      }),
    };
    const deps = baseDeps(failingAdmin);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      maybeFireCheckpoint(deps, baseSession(PHASE_ONE_MODULES), { id: "user-1", email: "alex@example.com" })
    ).resolves.toBeUndefined();
    expect(deps.dispatchHunt).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
