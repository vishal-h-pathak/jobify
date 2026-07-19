import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthHandoff, type AuthClient, type AuthStorage, type StoredSession, type AuthState } from "./handoff";

function fakeStorage(initial: StoredSession | null = null): AuthStorage & { store: StoredSession | null } {
  const obj = {
    store: initial,
    async save(session: StoredSession) {
      obj.store = session;
    },
    async load() {
      return obj.store;
    },
    async clear() {
      obj.store = null;
    },
  };
  return obj;
}

function fakeAuthClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    setSession: vi.fn(async (tokens: StoredSession) => ({ session: tokens, error: null })),
    refreshSession: vi.fn(async (refreshToken: string) => ({
      session: { access_token: `new-access-for-${refreshToken}`, refresh_token: `new-refresh-for-${refreshToken}` },
      error: null,
    })),
    ...overrides,
  };
}

describe("AuthHandoff", () => {
  it("restore() with no stored session lands on signed_out", async () => {
    const machine = new AuthHandoff({ storage: fakeStorage(null), authClient: fakeAuthClient() });
    expect(await machine.restore()).toEqual({ kind: "signed_out" });
  });

  it("restore() with a stored session lands directly on signed_in", async () => {
    const session = { access_token: "a1", refresh_token: "r1" };
    const machine = new AuthHandoff({ storage: fakeStorage(session), authClient: fakeAuthClient() });
    expect(await machine.restore()).toEqual({ kind: "signed_in", session });
  });

  it("beginHandoff transitions signed_out -> handoff -> signed_in and persists the session", async () => {
    const storage = fakeStorage(null);
    const seen: AuthState[] = [];
    const machine = new AuthHandoff({ storage, authClient: fakeAuthClient(), onStateChange: (s) => seen.push(s) });
    const tokens = { access_token: "a1", refresh_token: "r1" };

    const final = await machine.beginHandoff(tokens);

    expect(seen.map((s) => s.kind)).toEqual(["handoff", "signed_in"]);
    expect(final).toEqual({ kind: "signed_in", session: tokens });
    expect(storage.store).toEqual(tokens);
  });

  it("beginHandoff failure (no session returned) falls back to signed_out and clears storage", async () => {
    const storage = fakeStorage({ access_token: "stale", refresh_token: "stale" });
    const authClient = fakeAuthClient({ setSession: vi.fn(async () => ({ session: null, error: "invalid token" })) });
    const machine = new AuthHandoff({ storage, authClient });

    const final = await machine.beginHandoff({ access_token: "bad", refresh_token: "bad" });

    expect(final).toEqual({ kind: "signed_out" });
    expect(storage.store).toBeNull();
  });

  it("refresh() transitions signed_in -> refreshing -> signed_in with the new session", async () => {
    const session = { access_token: "a1", refresh_token: "r1" };
    const storage = fakeStorage(session);
    const seen: AuthState[] = [];
    const machine = new AuthHandoff({ storage, authClient: fakeAuthClient(), onStateChange: (s) => seen.push(s) });
    await machine.restore();
    seen.length = 0;

    const final = await machine.refresh();

    expect(seen.map((s) => s.kind)).toEqual(["refreshing", "signed_in"]);
    expect(final).toEqual({ kind: "signed_in", session: { access_token: "new-access-for-r1", refresh_token: "new-refresh-for-r1" } });
    expect(storage.store).toEqual({ access_token: "new-access-for-r1", refresh_token: "new-refresh-for-r1" });
  });

  it("refresh() is a no-op from signed_out", async () => {
    const machine = new AuthHandoff({ storage: fakeStorage(null), authClient: fakeAuthClient() });
    await machine.restore();
    expect(await machine.refresh()).toEqual({ kind: "signed_out" });
  });

  it("refresh() failure clears storage and falls back to signed_out", async () => {
    const session = { access_token: "a1", refresh_token: "r1" };
    const storage = fakeStorage(session);
    const authClient = fakeAuthClient({ refreshSession: vi.fn(async () => ({ session: null, error: "expired" })) });
    const machine = new AuthHandoff({ storage, authClient });
    await machine.restore();

    const final = await machine.refresh();

    expect(final).toEqual({ kind: "signed_out" });
    expect(storage.store).toBeNull();
  });

  it("signOut() clears storage and transitions to signed_out from any state", async () => {
    const session = { access_token: "a1", refresh_token: "r1" };
    const storage = fakeStorage(session);
    const machine = new AuthHandoff({ storage, authClient: fakeAuthClient() });
    await machine.restore();

    expect(await machine.signOut()).toEqual({ kind: "signed_out" });
    expect(storage.store).toBeNull();
  });

  it("never passes a token to console.* across a full handoff + refresh + signOut flow", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    try {
      const machine = new AuthHandoff({ storage: fakeStorage(null), authClient: fakeAuthClient() });
      await machine.beginHandoff({ access_token: "secret-access", refresh_token: "secret-refresh" });
      await machine.refresh();
      await machine.signOut();
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      consoleSpies.forEach((s) => s.mockRestore());
    }
  });
});
