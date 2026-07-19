import Anthropic from "@anthropic-ai/sdk";

export const ONBOARDING_MODEL = process.env.ONBOARDING_CLAUDE_MODEL?.trim() || "claude-sonnet-5";

/**
 * Transport selection (owner directive, 2026-07-19, testing posture):
 *
 * - `CLAUDE_CODE_OAUTH_TOKEN` set → the Claude-Max-subscription transport:
 *   bearer auth + the oauth beta header, with the Claude Code identity
 *   prepended as the first system block of every /v1/messages request (the
 *   handshake that token class expects). This is the serverless sibling of
 *   `jobify/shared/llm.py`'s Agent-SDK OAuth fallback (which shells out to
 *   the CLI and therefore can't run on Vercel). All call sites are
 *   untouched — the injection happens in the fetch wrapper below.
 * - Otherwise → the original ANTHROPIC_API_KEY path, byte-identical
 *   behavior to before this change.
 *
 * Cost telemetry is transport-independent: `response.usage` comes back the
 * same either way, so every budget-ledger row still records real token
 * counts and the at-API-prices cost — which is exactly the "what would this
 * cost per user" measurement the testing run wants. OFF-LABEL NOTE: the
 * OAuth token class is issued for Claude Code; serving multi-user product
 * traffic on it is not a long-term posture. Testing only — switch back to a
 * funded API key (unset the env var, redeploy) before friends onboard.
 */

const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

type SystemBlock = { type: string; text?: string; [k: string]: unknown };

function injectIdentityBlock(bodyText: string): string {
  const body = JSON.parse(bodyText) as { system?: string | SystemBlock[] };
  const sys = body.system;
  const blocks: SystemBlock[] =
    typeof sys === "string" ? [{ type: "text", text: sys }] : Array.isArray(sys) ? sys : [];
  const alreadyFirst = blocks[0]?.type === "text" && blocks[0]?.text === CLAUDE_CODE_IDENTITY;
  body.system = alreadyFirst ? blocks : [{ type: "text", text: CLAUDE_CODE_IDENTITY }, ...blocks];
  return JSON.stringify(body);
}

function oauthFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const isMessages = String(url).includes("/v1/messages");
  if (isMessages && init?.body && typeof init.body === "string") {
    try {
      const body = injectIdentityBlock(init.body);
      // The SDK precomputes content-length for the ORIGINAL body; ours is
      // longer after injection, and undici hard-fails on the mismatch
      // (UND_ERR_REQ_CONTENT_LENGTH_MISMATCH — caught live 2026-07-19).
      // Drop the stale header so fetch recomputes it from the new body.
      const headers = new Headers(init.headers as HeadersInit | undefined);
      headers.delete("content-length");
      init = { ...init, body, headers };
    } catch {
      // Malformed/non-JSON body: send unmodified rather than break the call.
    }
  }
  return fetch(url, init);
}

let _client: Anthropic | null = null;

/** Lazy singleton so this module imports fine without either env var set. */
export function anthropicClient(): Anthropic {
  if (!_client) {
    const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    if (oauthToken) {
      _client = new Anthropic({
        apiKey: null,
        authToken: oauthToken,
        defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
        fetch: oauthFetch as typeof fetch,
      });
    } else {
      _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
  }
  return _client;
}
