"""ABOUTME: Tests SpoolEase-compatible encryption/decryption roundtrips.
ABOUTME: Verifies payload format and key derivation assumptions."""

from bambu_hando.encryption import decrypt_text, derive_key, encrypt_text


def test_roundtrip_encryption() -> None:
    key = derive_key("TESTKEY")
    plaintext = '{"hello":"world"}'
    encrypted = encrypt_text(key, plaintext)
    decrypted = decrypt_text(key, encrypted)
    assert decrypted == plaintext


def test_different_ciphertexts_for_same_plaintext() -> None:
    key = derive_key("TESTKEY")
    c1 = encrypt_text(key, "abc")
    c2 = encrypt_text(key, "abc")
    assert c1 != c2
