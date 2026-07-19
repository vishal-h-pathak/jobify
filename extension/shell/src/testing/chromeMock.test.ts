import { describe, expect, it, beforeEach } from "vitest";
import { installChromeMock } from "./chromeMock";

describe("installChromeMock", () => {
  let mock: ReturnType<typeof installChromeMock>;

  beforeEach(() => {
    mock = installChromeMock();
  });

  it("storage.session round-trips set/get/remove", async () => {
    await chrome.storage.session.set({ a: 1, b: "two" });
    expect(await chrome.storage.session.get(["a", "b"])).toEqual({ a: 1, b: "two" });
    await chrome.storage.session.remove("a");
    expect(await chrome.storage.session.get(["a", "b"])).toEqual({ b: "two" });
  });

  it("storage.session.clear empties the store", async () => {
    await chrome.storage.session.set({ a: 1 });
    await chrome.storage.session.clear();
    expect(await chrome.storage.session.get(null)).toEqual({});
  });

  it("runtime.onMessage listeners fire via emitRuntimeMessage and can respond", async () => {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      sendResponse({ echoed: message });
      return true;
    });
    const response = await mock.emitRuntimeMessage({ hello: "world" });
    expect(response).toEqual({ echoed: { hello: "world" } });
  });

  it("reset() clears storage, listeners, and mock call history", async () => {
    await chrome.storage.session.set({ a: 1 });
    chrome.runtime.onMessage.addListener(() => {});
    await chrome.runtime.sendMessage({ x: 1 });

    mock.reset();

    expect(await chrome.storage.session.get(null)).toEqual({});
    expect(mock.runtimeMessageListeners).toHaveLength(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
