import { describe, expect, it, beforeEach } from "vitest";
import { installChromeMock, type ChromeMock } from "../testing/chromeMock";
import { chromeSessionStorage } from "./chromeSessionStorage";

describe("chromeSessionStorage", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  it("round-trips a session through save/load", async () => {
    const session = { access_token: "a1", refresh_token: "r1" };
    await chromeSessionStorage.save(session);
    expect(await chromeSessionStorage.load()).toEqual(session);
  });

  it("load() returns null when nothing is stored", async () => {
    expect(await chromeSessionStorage.load()).toBeNull();
  });

  it("clear() removes the stored session", async () => {
    await chromeSessionStorage.save({ access_token: "a1", refresh_token: "r1" });
    await chromeSessionStorage.clear();
    expect(await chromeSessionStorage.load()).toBeNull();
  });

  it("never touches chrome.storage.local", async () => {
    await chromeSessionStorage.save({ access_token: "a1", refresh_token: "r1" });
    await chromeSessionStorage.load();
    await chromeSessionStorage.clear();
    expect(mock.chrome.storage.local.set).not.toHaveBeenCalled();
    expect(mock.chrome.storage.local.get).not.toHaveBeenCalled();
    expect(mock.chrome.storage.local.remove).not.toHaveBeenCalled();
  });
});
