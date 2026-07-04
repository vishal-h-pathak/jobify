"""jobify.hosted.keycrypt — decrypt a BYO Anthropic key (H6 cost rails).

Wire format (identical in both runtimes — see `web/lib/crypto/keys.ts` for
the encrypt side): ``v1:<base64 nonce>:<base64 ciphertext+tag>``. AES-256-GCM,
a fresh random 12-byte nonce per encryption, the GCM tag appended to the
ciphertext (node:crypto's ``Buffer.concat([encrypted, authTag])``
convention — ``cryptography``'s ``AESGCM`` expects/produces that exact
concatenated shape on this side too, so there's no re-splitting to do).

The 32-byte secret comes from ``JOBIFY_KEY_ENCRYPTION_SECRET`` (base64),
resolved once at process start by `jobify.config` (the same convention
every other secret in that module follows) — a secret rotation takes
effect on the worker's next restart, not mid-process.
"""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from jobify.config import JOBIFY_KEY_ENCRYPTION_SECRET

_WIRE_VERSION = "v1"


class KeyDecryptionError(RuntimeError):
    """A BYO key ciphertext could not be decrypted — bad wire format,
    a rotated/wrong secret, or a corrupted row. `jobify.hosted.fanout`
    catches this and falls back to pool-with-caps for that user rather
    than letting a decryption failure crash the cycle.
    """


def _secret_bytes() -> bytes:
    raw = (JOBIFY_KEY_ENCRYPTION_SECRET or "").strip()
    if not raw:
        raise KeyDecryptionError("JOBIFY_KEY_ENCRYPTION_SECRET is not set")
    try:
        key = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise KeyDecryptionError(
            f"JOBIFY_KEY_ENCRYPTION_SECRET is not valid base64: {exc}"
        ) from exc
    if len(key) != 32:
        raise KeyDecryptionError(
            f"JOBIFY_KEY_ENCRYPTION_SECRET must decode to 32 bytes, got {len(key)}"
        )
    return key


def decrypt_key(ciphertext_blob: str) -> str:
    """Decrypt a ``v1:<b64 nonce>:<b64 ciphertext+tag>`` blob into the
    plaintext Anthropic key.

    Raises `KeyDecryptionError` on any failure (bad format, wrong/rotated
    secret, tampered or corrupted ciphertext) — never returns a partial
    or garbage plaintext.
    """
    parts = (ciphertext_blob or "").split(":")
    if len(parts) != 3 or parts[0] != _WIRE_VERSION:
        raise KeyDecryptionError(
            f"unrecognized wire format (want '{_WIRE_VERSION}:<nonce>:<ciphertext>')"
        )
    _version, nonce_b64, ct_b64 = parts
    try:
        nonce = base64.b64decode(nonce_b64, validate=True)
        ciphertext = base64.b64decode(ct_b64, validate=True)
    except Exception as exc:
        raise KeyDecryptionError(f"invalid base64 in ciphertext blob: {exc}") from exc

    aesgcm = AESGCM(_secret_bytes())
    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    except KeyDecryptionError:
        raise
    except Exception as exc:  # tag mismatch, wrong key, corrupted ciphertext
        raise KeyDecryptionError(f"AES-GCM decryption failed: {exc}") from exc
    return plaintext.decode("utf-8")
