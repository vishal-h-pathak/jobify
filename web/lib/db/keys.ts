import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { encryptKey, last4 } from "../crypto/keys";

/** Loosest shape check for a pasted Anthropic key — no live API call (that
 * would spend real tokens just to validate a paste). Anthropic key ids
 * start with `sk-ant-`; a generous minimum length catches empty/truncated
 * pastes without hardcoding an exact format that could change upstream. */
export function looksLikeAnthropicKey(value: string): boolean {
  return value.startsWith("sk-ant-") && value.length >= 20;
}

/**
 * Encrypt and upsert the signed-in user's BYO Anthropic key. The RLS
 * own-row insert/update policies (0002_multitenant.sql) already scope this
 * to `auth.uid() = user_id`, so the authed request-scoped client is enough
 * — no admin client needed. The plaintext key never leaves this function:
 * only its ciphertext (`encryptKey`) and last-4 (`last4`) are persisted.
 */
export async function saveApiKey(
  supabase: SupabaseClient<Database>,
  userId: string,
  plaintextKey: string
): Promise<void> {
  const { error } = await supabase.from("api_keys").upsert({
    user_id: userId,
    provider: "anthropic",
    encrypted_key: encryptKey(plaintextKey),
    key_last4: last4(plaintextKey),
  });
  if (error) throw error;
}

/** Remove the signed-in user's BYO key — 0006_cost_rails.sql's new
 * own-row DELETE policy (0002 shipped without one). */
export async function deleteApiKey(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<void> {
  const { error } = await supabase.from("api_keys").delete().eq("user_id", userId);
  if (error) throw error;
}

export interface ApiKeyInfo {
  keyLast4: string | null;
  updatedAt: string;
}

/** Settings-page display info for the signed-in user's BYO key — never
 * the ciphertext, only what the UI shows back ("...last4"). */
export async function getApiKeyInfo(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ApiKeyInfo | null> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("key_last4, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { keyLast4: data.key_last4, updatedAt: data.updated_at } : null;
}
