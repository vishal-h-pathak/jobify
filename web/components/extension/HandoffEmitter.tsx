"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Session } from "@supabase/supabase-js";

export const HANDOFF_EVENT = "jobify:auth-handoff";

export type HandoffDetail = { access_token: string; refresh_token: string };

// Emits the session to the jobify browser extension's content script via a
// same-origin DOM CustomEvent — never logged to the developer console, never
// via a URL, never inside a thrown Error (same never-log rule as
// web/lib/hunt/dispatchHunt.ts's GitHub token handling). The extension's
// content script (built separately)
// listens for `jobify:auth-handoff` on this origin and relays it to the
// extension's background worker over chrome.runtime.sendMessage; nothing in
// this file talks to chrome.* directly, since a normal web page has no access
// to those APIs.

/**
 * Pure mapping from a Supabase session to the handoff payload. `null` in,
 * `null` out (no session -> nothing to emit). Exported so it's directly
 * unit-testable without a DOM environment — see HandoffEmitter.test.tsx.
 */
export function buildHandoffDetail(session: Session | null): HandoffDetail | null {
  if (!session) return null;
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}

/**
 * Builds the detail from `session` and hands it to `dispatch` as a
 * `CustomEvent`. No-ops when there's no session. `dispatch` defaults to
 * `window.dispatchEvent` (the real behavior in the browser) but is
 * injectable so this is unit-testable without a DOM/jsdom environment —
 * this repo has neither `@testing-library/react` nor `jsdom` installed
 * (checked package.json + node_modules before adding this seam).
 */
export function emitHandoff(
  session: Session | null,
  dispatch: (event: CustomEvent<HandoffDetail>) => void = (event) => window.dispatchEvent(event)
): void {
  const detail = buildHandoffDetail(session);
  if (!detail) return;
  dispatch(new CustomEvent<HandoffDetail>(HANDOFF_EVENT, { detail }));
}

export function HandoffEmitter() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => emitHandoff(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => emitHandoff(session));
    return () => subscription.subscription.unsubscribe();
  }, []);
  return null;
}
