import { describe, expect, it, vi, beforeEach } from "vitest";
import { installChromeMock, type ChromeMock } from "../testing/chromeMock";
import { installHandoffRelay } from "./handoffRelay";
import { HANDOFF_EVENT } from "./handoffEventContract";

describe("installHandoffRelay", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  it("relays a jobify:auth-handoff event's detail to the background worker", () => {
    installHandoffRelay(window);

    window.dispatchEvent(new CustomEvent(HANDOFF_EVENT, { detail: { access_token: "a1", refresh_token: "r1" } }));

    expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "handoff",
      tokens: { access_token: "a1", refresh_token: "r1" },
    });
  });

  it("ignores an event with a missing token rather than relaying a partial payload", () => {
    installHandoffRelay(window);

    window.dispatchEvent(new CustomEvent(HANDOFF_EVENT, { detail: { access_token: "a1" } }));

    expect(mock.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("ignores unrelated events", () => {
    installHandoffRelay(window);

    window.dispatchEvent(new CustomEvent("some-other-event", { detail: { access_token: "a1", refresh_token: "r1" } }));

    expect(mock.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("never passes the token to console.*", () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    installHandoffRelay(window);

    window.dispatchEvent(new CustomEvent(HANDOFF_EVENT, { detail: { access_token: "secret-a", refresh_token: "secret-r" } }));

    consoleSpies.forEach((s) => {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    });
  });
});
