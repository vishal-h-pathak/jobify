import Anthropic from "@anthropic-ai/sdk";

export const ONBOARDING_MODEL = process.env.ONBOARDING_CLAUDE_MODEL?.trim() || "claude-sonnet-5";

let _client: Anthropic | null = null;

/** Lazy singleton so this module imports fine without ANTHROPIC_API_KEY set. */
export function anthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}
