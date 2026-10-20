"""ABOUTME: AES-256-GCM codec compatible with SpoolEase encrypted REST endpoints.
ABOUTME: Mirrors known PBKDF2 and payload formatting used by SpoolEase ecosystem."""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


DEFAULT_SALT = "example_salt"
DEFAULT_ITERATIONS = 10_000


def derive_key(security_key: str, salt: str = DEFAULT_SALT, iterations: int = DEFAULT_ITERATIONS) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256",
        security_key.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
        dklen=32,
    )


def _b64_no_pad_encode(data: bytes) -> str:
    return base64.b64encode(data).rstrip(b"=").decode("ascii")


def _b64_no_pad_decode(text: str) -> bytes:
    padded = text + "=" * (-len(text) % 4)
    return base64.b64decode(padded)


def encrypt_text(key: bytes, plaintext: str) -> str:
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return _b64_no_pad_encode(nonce) + _b64_no_pad_encode(ciphertext)


def decrypt_text(key: bytes, encrypted: str) -> str:
    nonce = _b64_no_pad_decode(encrypted[:16])
    payload = _b64_no_pad_decode(encrypted[16:])
    plaintext = AESGCM(key).decrypt(nonce, payload, None)
    return plaintext.decode("utf-8")
