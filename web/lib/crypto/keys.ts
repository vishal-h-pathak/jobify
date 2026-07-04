import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * BYO Anthropic key encryption (H6 cost rails). Wire format — identical in
 * both runtimes, see `jobify/hosted/keycrypt.py` for the decrypt side:
 *
 *     v1:<base64 nonce>:<base64 ciphertext+tag>
 *
 * AES-256-GCM, a fresh random 12-byte nonce per call, the GCM auth tag
 * appended to the ciphertext (`Buffer.concat([encrypted, authTag])`) rather
 * than carried as a separate field — Python's `cryptography.AESGCM` expects
 * that exact concatenated shape, so the two sides need no extra framing.
 *
 * `decryptKey` only exists here for this module's own roundtrip test
 * (`keys.test.ts`); production decryption always happens on the Python
 * side (`jobify.hosted.fanout`), never in the web app.
 */

const WIRE_VERSION = "v1";
const NONCE_BYTES = 12;

function secretBytes(): Buffer {
  const raw = (process.env.JOBIFY_KEY_ENCRYPTION_SECRET ?? "").trim();
  if (!raw) throw new Error("JOBIFY_KEY_ENCRYPTION_SECRET is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`JOBIFY_KEY_ENCRYPTION_SECRET must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

export function encryptKey(plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", secretBytes(), nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return `${WIRE_VERSION}:${nonce.toString("base64")}:${ciphertext.toString("base64")}`;
}

const GCM_TAG_BYTES = 16;

export function decryptKey(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 3 || parts[0] !== WIRE_VERSION) {
    throw new Error(`unrecognized wire format (want '${WIRE_VERSION}:<nonce>:<ciphertext>')`);
  }
  const [, nonceB64, ciphertextB64] = parts;
  const nonce = Buffer.from(nonceB64, "base64");
  const ciphertextAndTag = Buffer.from(ciphertextB64, "base64");
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - GCM_TAG_BYTES);
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - GCM_TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", secretBytes(), nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Last 4 characters of a plaintext key, for the settings UI's "...last4" display. */
export function last4(plaintext: string): string {
  return plaintext.slice(-4);
}
