// The auth handoff state machine (V3C_DESIGN.md §8 owner decision D2): the
// web app hands its session to the extension; there is no separate login.
// States: signed_out -> handoff -> signed_in -> refreshing -> signed_in
// (or back to signed_out on any failure). Every dependency (storage,
// Supabase auth calls) is injected — this file never touches chrome.* or
// @supabase/supabase-js directly, so it is fully testable with fakes and
// carries zero I/O of its own.
//
// Never-log rule (mirrors web/lib/hunt/dispatchHunt.ts's GitHub-token rule):
// no token in this file is ever passed to console.*, thrown inside an Error
// message, or interpolated into a URL string. Enforced by
// handoff.test.ts's full-flow console-spy assertion.

export type StoredSession = { access_token: string; refresh_token: string };

export type AuthState =
  | { kind: "signed_out" }
  | { kind: "handoff" }
  | { kind: "signed_in"; session: StoredSession }
  | { kind: "refreshing"; session: StoredSession };

export interface AuthStorage {
  save(session: StoredSession): Promise<void>;
  load(): Promise<StoredSession | null>;
  clear(): Promise<void>;
}

export type AuthResult = { session: StoredSession | null; error: string | null };

export interface AuthClient {
  setSession(tokens: StoredSession): Promise<AuthResult>;
  refreshSession(refreshToken: string): Promise<AuthResult>;
}

export interface AuthDeps {
  storage: AuthStorage;
  authClient: AuthClient;
  onStateChange?: (state: AuthState) => void;
}

export class AuthHandoff {
  private state: AuthState = { kind: "signed_out" };

  constructor(private readonly deps: AuthDeps) {}

  getState(): AuthState {
    return this.state;
  }

  private setState(next: AuthState): AuthState {
    this.state = next;
    this.deps.onStateChange?.(next);
    return next;
  }

  /** Loads any previously-stored session on background-worker startup. */
  async restore(): Promise<AuthState> {
    const stored = await this.deps.storage.load();
    return this.setState(stored ? { kind: "signed_in", session: stored } : { kind: "signed_out" });
  }

  /** Runs when the app-origin content script relays a handoff message. */
  async beginHandoff(tokens: StoredSession): Promise<AuthState> {
    this.setState({ kind: "handoff" });
    const result = await this.deps.authClient.setSession(tokens);
    if (!result.session) {
      await this.deps.storage.clear();
      return this.setState({ kind: "signed_out" });
    }
    await this.deps.storage.save(result.session);
    return this.setState({ kind: "signed_in", session: result.session });
  }

  /** Refreshes the current session; only valid from signed_in. */
  async refresh(): Promise<AuthState> {
    if (this.state.kind !== "signed_in") return this.state;
    const current = this.state.session;
    this.setState({ kind: "refreshing", session: current });
    const result = await this.deps.authClient.refreshSession(current.refresh_token);
    if (!result.session) {
      await this.deps.storage.clear();
      return this.setState({ kind: "signed_out" });
    }
    await this.deps.storage.save(result.session);
    return this.setState({ kind: "signed_in", session: result.session });
  }

  async signOut(): Promise<AuthState> {
    await this.deps.storage.clear();
    return this.setState({ kind: "signed_out" });
  }
}
