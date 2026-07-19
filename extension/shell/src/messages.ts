import type { AuthState, StoredSession } from "./auth/handoff";
import type { FillFlowResult } from "./fillFlow/fillFlow";

// Panel/content-script -> background, over chrome.runtime.sendMessage.
export type BackgroundRequest =
  | { type: "handoff"; tokens: StoredSession } // sent by content/handoffRelay.ts
  | { type: "get_auth_state" }
  | { type: "refresh" }
  | { type: "sign_out" };

export type BackgroundResponse = { state: AuthState };

// Background -> every extension context (panel included), broadcast on every
// AuthHandoff state transition so the panel repaints without polling.
export type AuthStateChangedBroadcast = { type: "auth_state_changed"; state: AuthState };

// Panel -> the ATS tab's content script, over chrome.tabs.sendMessage
// (tab-scoped, never reaches the background listener).
export type ContentFillRequest = { type: "fill_this_page"; postingId: string };
export type ContentFillResponse = FillFlowResult;
