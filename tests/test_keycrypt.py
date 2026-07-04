"""tests/test_keycrypt.py — jobify.hosted.keycrypt (H6 BYO keys).

AES-256-GCM decrypt side: wire format parsing, roundtrip against a
same-process AESGCM encrypt, failure modes (wrong secret, tampered
ciphertext, bad format, missing secret), and the cross-runtime fixture —
a blob produced by `web/lib/crypto/keys.ts`'s node:crypto implementation,
hardcoded here so this test proves the two runtimes actually agree on the
wire format without needing node at test time. No network, no live
Supabase — this module doesn't touch the DB at all.
"""

from __future__ import annotations

import base64
import os

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from jobify.hosted import keycrypt

_TEST_SECRET_B64 = base64.b64encode(b"\x01" * 32).decode()


def _encrypt(plaintext: str, secret_b64: str, nonce: bytes | None = None) -> str:
    """Test-side encrypt helper — mirrors `web/lib/crypto/keys.ts`'s
    algorithm exactly (AES-256-GCM, tag appended to ciphertext) so the
    roundtrip test proves `decrypt_key` accepts what an encryptor
    following the documented wire format actually produces."""
    key = base64.b64decode(secret_b64)
    nonce = nonce or os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return f"v1:{base64.b64encode(nonce).decode()}:{base64.b64encode(ciphertext).decode()}"


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setattr(keycrypt, "JOBIFY_KEY_ENCRYPTION_SECRET", _TEST_SECRET_B64)


def test_decrypt_key_roundtrip():
    blob = _encrypt("sk-ant-api03-roundtrip-test-key", _TEST_SECRET_B64)
    assert keycrypt.decrypt_key(blob) == "sk-ant-api03-roundtrip-test-key"


def test_decrypt_key_wrong_secret_raises(monkeypatch):
    blob = _encrypt("sk-ant-api03-wrong-secret", _TEST_SECRET_B64)
    monkeypatch.setattr(
        keycrypt, "JOBIFY_KEY_ENCRYPTION_SECRET", base64.b64encode(b"\x02" * 32).decode(),
    )
    with pytest.raises(keycrypt.KeyDecryptionError):
        keycrypt.decrypt_key(blob)


def test_decrypt_key_tampered_ciphertext_raises():
    blob = _encrypt("sk-ant-api03-tamper-test", _TEST_SECRET_B64)
    version, nonce_b64, ct_b64 = blob.split(":")
    ct = bytearray(base64.b64decode(ct_b64))
    ct[0] ^= 0xFF  # flip a byte -> GCM tag verification must fail
    tampered = f"{version}:{nonce_b64}:{base64.b64encode(bytes(ct)).decode()}"
    with pytest.raises(keycrypt.KeyDecryptionError):
        keycrypt.decrypt_key(tampered)


@pytest.mark.parametrize(
    "blob",
    [
        "not-even-colon-separated",
        "v2:bm9uY2U=:Y2lwaGVydGV4dA==",  # wrong version prefix
        "v1:only-two-parts",
        "v1:not-base64!!!:Y2lwaGVydGV4dA==",
    ],
)
def test_decrypt_key_bad_wire_format_raises(blob):
    with pytest.raises(keycrypt.KeyDecryptionError):
        keycrypt.decrypt_key(blob)


def test_decrypt_key_secret_not_set_raises(monkeypatch):
    monkeypatch.setattr(keycrypt, "JOBIFY_KEY_ENCRYPTION_SECRET", "")
    blob = _encrypt("sk-ant-api03-no-secret", _TEST_SECRET_B64)
    with pytest.raises(keycrypt.KeyDecryptionError, match="not set"):
        keycrypt.decrypt_key(blob)


def test_decrypt_key_secret_wrong_length_raises(monkeypatch):
    monkeypatch.setattr(keycrypt, "JOBIFY_KEY_ENCRYPTION_SECRET", base64.b64encode(b"short").decode())
    blob = _encrypt("sk-ant-api03-short-secret", _TEST_SECRET_B64)
    with pytest.raises(keycrypt.KeyDecryptionError, match="32 bytes"):
        keycrypt.decrypt_key(blob)


# ── Cross-runtime fixture ─────────────────────────────────────────────────
# Generated with `node:crypto` (web/lib/crypto/keys.ts's exact algorithm:
# AES-256-GCM, a fixed 12-byte nonce for reproducibility, tag appended to
# ciphertext) under the secret below — see web/lib/crypto/keys.test.ts for
# the TS-side roundtrip. This proves the two runtimes agree on the wire
# format without needing node installed at Python test time.

_CROSS_RUNTIME_SECRET_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
_CROSS_RUNTIME_PLAINTEXT = "sk-ant-api03-cross-runtime-fixture-DO-NOT-USE-0000000000000000"
_CROSS_RUNTIME_BLOB = (
    "v1:MDEyMzQ1Njc4OWFi:"
    "Ze1QMXyHhrXtES1csv5qnSEd9GDJ5NwBfU0k2zeYKyljciRZ2slXb7pRMkCnSjv7"
    "ZqArIcR2ArEigc6qP0LucPlMdkbE9AJpkldVqPZB"
)


def test_cross_runtime_fixture_decrypts(monkeypatch):
    monkeypatch.setattr(keycrypt, "JOBIFY_KEY_ENCRYPTION_SECRET", _CROSS_RUNTIME_SECRET_B64)
    assert keycrypt.decrypt_key(_CROSS_RUNTIME_BLOB) == _CROSS_RUNTIME_PLAINTEXT
