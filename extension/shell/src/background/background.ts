import type { AuthHandoff, AuthState } from "../auth/handoff";
import type { BackgroundRequest } from "../messages";

/**
 * Wires an already-constructed `AuthHandoff` to `chrome.runtime.onMessage`
 * and kicks off `restore()`. Takes the instance (rather than constructing
 * its own) so `background.test.ts` can pass one built against a fake
 * `AuthClient`, and `index.ts` (the real manifest entry point) can pass one
 * built against `createSupabaseAuthClient` + `chromeSessionStorage`. This
 * file has no other side effects and is safe to import from tests.
 */
export function createBackground(authHandoff: AuthHandoff) {
  authHandoff.restore();

  chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
    handleMessage(authHandoff, message)
      .then((state) => sendResponse({ state }))
      .catch(() => sendResponse({ state: authHandoff.getState() }));
    return true; // keep the message channel open for the async response
  });

  return authHandoff;
}

async function handleMessage(authHandoff: AuthHandoff, message: BackgroundRequest): Promise<AuthState> {
  switch (message.type) {
    case "handoff":
      return authHandoff.beginHandoff(message.tokens);
    case "get_auth_state":
      return authHandoff.getState();
    case "refresh":
      return authHandoff.refresh();
    case "sign_out":
      return authHandoff.signOut();
    default:
      return authHandoff.getState();
  }
}
