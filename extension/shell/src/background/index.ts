// The real manifest `background.service_worker` entry point — the only
// file in this package that wires production dependencies (real Supabase
// auth client, real chrome.storage.session) into `createBackground`.
// background.ts stays test-friendly by taking its `AuthHandoff` as a
// parameter instead of constructing one itself.
import { AuthHandoff } from "../auth/handoff";
import { chromeSessionStorage } from "../auth/chromeSessionStorage";
import { createSupabaseAuthClient } from "../auth/supabaseAuthClient";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";
import { createBackground } from "./background";
import type { AuthStateChangedBroadcast } from "../messages";

createBackground(
  new AuthHandoff({
    storage: chromeSessionStorage,
    authClient: createSupabaseAuthClient(SUPABASE_URL, SUPABASE_ANON_KEY),
    onStateChange: (state) => {
      const broadcast: AuthStateChangedBroadcast = { type: "auth_state_changed", state };
      chrome.runtime.sendMessage(broadcast).catch(() => {}); // no listener open (panel closed) -> ignore
    },
  })
);

// No `default_popup` on the toolbar action (manifest.json) — clicking it
// opens the side panel instead, per chrome.sidePanel's own documented
// pattern for this exact setup.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
