import { createClient } from "@supabase/supabase-js";
import type { AuthClient, AuthResult, StoredSession } from "./handoff";

// The one place in this package that talks to Supabase directly.
//
// V3C_DESIGN.md §0's "no fetch to any non-app origin except the packet's
// signed storage URLs" constitution line targets the fill/ATS side of the
// extension — the concern is a content script quietly exfiltrating data or
// making a hidden LLM call from a job-application page. An extension
// refreshing its own auth session against the same Supabase project the web
// app already trusts is ordinary SPA/extension auth plumbing, and the
// session prompt's build step 2 names it explicitly: "refresh handled via
// supabase-js in the shell's background worker." Flagged here for the
// reviewer rather than silently assumed.
//
// `persistSession: false` — this package owns persistence itself via
// `AuthStorage`/`chromeSessionStorage.ts` (chrome.storage.session); letting
// supabase-js also try to persist to `localStorage` would both duplicate
// state and fail outright, since MV3 service workers have no `window`.
// `autoRefreshToken: false` — refresh is driven explicitly by
// `AuthHandoff.refresh()`, not by a background timer a service worker can't
// reliably keep alive.
export function createSupabaseAuthClient(supabaseUrl: string, supabaseAnonKey: string): AuthClient {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  function toResult(session: { access_token: string; refresh_token: string } | null, error: { message: string } | null): AuthResult {
    if (error || !session) return { session: null, error: error?.message ?? "no session returned" };
    return { session: { access_token: session.access_token, refresh_token: session.refresh_token }, error: null };
  }

  return {
    async setSession(tokens: StoredSession): Promise<AuthResult> {
      const { data, error } = await client.auth.setSession(tokens);
      return toResult(data.session, error);
    },
    async refreshSession(refreshToken: string): Promise<AuthResult> {
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      return toResult(data.session, error);
    },
  };
}
