import type { AuthStorage, StoredSession } from "./handoff";

// `chrome.storage.session` (memory-backed, cleared when the browser fully
// quits) per the session prompt's default — never `.local` (which would
// leave a long-lived refresh token on disk), and `chrome.storage.session`
// already survives MV3 service-worker restarts within one browser session,
// which is the only reason a naive in-memory JS variable wouldn't do here.
const KEY = "jobify:session";

export const chromeSessionStorage: AuthStorage = {
  async save(session: StoredSession): Promise<void> {
    await chrome.storage.session.set({ [KEY]: session });
  },
  async load(): Promise<StoredSession | null> {
    const result = await chrome.storage.session.get(KEY);
    const session = result[KEY] as StoredSession | undefined;
    return session ?? null;
  },
  async clear(): Promise<void> {
    await chrome.storage.session.remove(KEY);
  },
};
