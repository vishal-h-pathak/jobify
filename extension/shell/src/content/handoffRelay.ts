import type { BackgroundRequest } from "../messages";
import type { HandoffDetail } from "./handoffEventContract";
import { HANDOFF_EVENT } from "./handoffEventContract";

/**
 * The app-origin content script half of the token handoff (build step 2).
 * Matched only on the app origin (manifest.json). Listens for the
 * `jobify:auth-handoff` DOM CustomEvent `web/components/extension/
 * HandoffEmitter.tsx` dispatches on the page, and relays its detail to the
 * background worker over chrome.runtime.sendMessage — this file never
 * touches the token itself beyond passing it through, and never logs it.
 */
export function installHandoffRelay(target: EventTarget = window): void {
  target.addEventListener(HANDOFF_EVENT, (event) => {
    const detail = (event as CustomEvent<HandoffDetail>).detail;
    if (!detail?.access_token || !detail?.refresh_token) return;
    const message: BackgroundRequest = { type: "handoff", tokens: detail };
    chrome.runtime.sendMessage(message);
  });
}
