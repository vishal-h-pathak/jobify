import { vi } from "vitest";

// Minimal mocked-`chrome` global for unit tests. Covers exactly the surface
// this package's manifest declares (storage, sidePanel, activeTab/tabs,
// runtime messaging) — nothing more, so a test reaching for an API this
// mock doesn't have is a signal the manifest may need to grow, not a gap to
// silently patch here.

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | void;

export interface ChromeMock {
  chrome: typeof chrome;
  storageSessionStore: Map<string, unknown>;
  runtimeMessageListeners: Listener[];
  emitRuntimeMessage: (message: unknown, sender?: Partial<chrome.runtime.MessageSender>) => Promise<unknown>;
  reset: () => void;
}

/**
 * Installs a fake `chrome` on `globalThis` and returns handles for
 * inspecting/driving it. Call `reset()` (or re-install) between tests.
 */
export function installChromeMock(): ChromeMock {
  const storageSessionStore = new Map<string, unknown>();
  const runtimeMessageListeners: Listener[] = [];

  const storageSession = {
    async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
      if (keys == null) return Object.fromEntries(storageSessionStore);
      const keyList = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result: Record<string, unknown> = {};
      for (const key of keyList) {
        if (storageSessionStore.has(key)) result[key] = storageSessionStore.get(key);
        else if (!Array.isArray(keys) && typeof keys !== "string") result[key] = (keys as Record<string, unknown>)[key];
      }
      return result;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(items)) storageSessionStore.set(key, value);
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const key of typeof keys === "string" ? [keys] : keys) storageSessionStore.delete(key);
    },
    async clear(): Promise<void> {
      storageSessionStore.clear();
    },
  };

  async function emitRuntimeMessage(message: unknown, sender: Partial<chrome.runtime.MessageSender> = {}): Promise<unknown> {
    let response: unknown;
    for (const listener of runtimeMessageListeners) {
      const result = await new Promise<unknown>((resolve) => {
        const maybeAsync = listener(message, sender as chrome.runtime.MessageSender, resolve);
        if (!maybeAsync) resolve(undefined);
      });
      if (result !== undefined) response = result;
    }
    return response;
  }

  const runtime = {
    id: "test-extension-id",
    sendMessage: vi.fn(async (_message: unknown) => undefined),
    onMessage: {
      addListener: (listener: Listener) => runtimeMessageListeners.push(listener),
      removeListener: (listener: Listener) => {
        const i = runtimeMessageListeners.indexOf(listener);
        if (i !== -1) runtimeMessageListeners.splice(i, 1);
      },
      hasListener: (listener: Listener) => runtimeMessageListeners.includes(listener),
    },
  };

  const tabs = {
    query: vi.fn(async () => [] as chrome.tabs.Tab[]),
    sendMessage: vi.fn(async (_tabId: number, _message: unknown) => undefined),
  };

  const sidePanel = {
    setOptions: vi.fn(async () => undefined),
    setPanelBehavior: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
  };

  // Present so code that (wrongly) reaches for `.local` fails a spy
  // assertion rather than a `chrome.storage.local is undefined` crash —
  // this package must only ever use `chrome.storage.session` (memory-backed;
  // see `auth/chromeSessionStorage.ts`'s header comment for why).
  const storageLocal = {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };

  const fakeChrome = {
    storage: { session: storageSession, local: storageLocal },
    runtime,
    tabs,
    sidePanel,
  } as unknown as typeof chrome;

  (globalThis as { chrome?: typeof chrome }).chrome = fakeChrome;

  return {
    chrome: fakeChrome,
    storageSessionStore,
    runtimeMessageListeners,
    emitRuntimeMessage,
    reset() {
      storageSessionStore.clear();
      runtimeMessageListeners.length = 0;
      runtime.sendMessage.mockClear();
      tabs.query.mockClear();
      tabs.sendMessage.mockClear();
      sidePanel.setOptions.mockClear();
      sidePanel.open.mockClear();
      storageLocal.get.mockClear();
      storageLocal.set.mockClear();
      storageLocal.remove.mockClear();
      storageLocal.clear.mockClear();
    },
  };
}
