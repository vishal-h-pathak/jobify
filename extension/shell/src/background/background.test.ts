import { describe, expect, it, vi, beforeEach } from "vitest";
import { installChromeMock, type ChromeMock } from "../testing/chromeMock";
import { AuthHandoff, type AuthClient, type AuthStorage, type StoredSession } from "../auth/handoff";
import { createBackground } from "./background";

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

function fakeAuthClient(): AuthClient {
  return {
    setSession: vi.fn(async (tokens: StoredSession) => ({ session: tokens, error: null })),
    refreshSession: vi.fn(async (refreshToken: string) => ({
      session: { access_token: `new-${refreshToken}`, refresh_token: refreshToken },
      error: null,
    })),
  };
}

describe("createBackground", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  it("restore()s on construction and responds to get_auth_state with the restored state", async () => {
    const storage = fakeStorage({ access_token: "a1", refresh_token: "r1" });
    createBackground(new AuthHandoff({ storage, authClient: fakeAuthClient() }));
    await Promise.resolve(); // let restore()'s promise settle

    const response = await mock.emitRuntimeMessage({ type: "get_auth_state" });

    expect(response).toEqual({ state: { kind: "signed_in", session: { access_token: "a1", refresh_token: "r1" } } });
  });

  it("routes a handoff message to beginHandoff and responds with the resulting state", async () => {
    const storage = fakeStorage(null);
    createBackground(new AuthHandoff({ storage, authClient: fakeAuthClient() }));

    const response = await mock.emitRuntimeMessage({ type: "handoff", tokens: { access_token: "a1", refresh_token: "r1" } });

    expect(response).toEqual({ state: { kind: "signed_in", session: { access_token: "a1", refresh_token: "r1" } } });
    expect(storage.store).toEqual({ access_token: "a1", refresh_token: "r1" });
  });

  it("routes a refresh message to refresh() and responds with the refreshed state", async () => {
    const storage = fakeStorage({ access_token: "a1", refresh_token: "r1" });
    createBackground(new AuthHandoff({ storage, authClient: fakeAuthClient() }));
    await Promise.resolve();

    const response = await mock.emitRuntimeMessage({ type: "refresh" });

    expect(response).toEqual({ state: { kind: "signed_in", session: { access_token: "new-r1", refresh_token: "r1" } } });
  });

  it("routes a sign_out message to signOut() and responds signed_out", async () => {
    const storage = fakeStorage({ access_token: "a1", refresh_token: "r1" });
    createBackground(new AuthHandoff({ storage, authClient: fakeAuthClient() }));
    await Promise.resolve();

    const response = await mock.emitRuntimeMessage({ type: "sign_out" });

    expect(response).toEqual({ state: { kind: "signed_out" } });
    expect(storage.store).toBeNull();
  });

  it("broadcasts every state transition via onStateChange, never with a raw token in a console call", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const seen: unknown[] = [];
    createBackground(new AuthHandoff({ storage: fakeStorage(null), authClient: fakeAuthClient(), onStateChange: (s) => seen.push(s) }));

    await mock.emitRuntimeMessage({ type: "handoff", tokens: { access_token: "secret", refresh_token: "secret" } });

    expect(seen.length).toBeGreaterThan(0);
    consoleSpies.forEach((s) => {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    });
  });
});
