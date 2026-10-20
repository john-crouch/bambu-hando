// ABOUTME: Tests SpoolEase-compatible AES-256-GCM encryption against Python reference vectors.
// ABOUTME: Proves wire compatibility: key derivation, nonce framing, and no-pad base64.

import { describe, expect, it } from "vitest";

import { decryptText, deriveKey, encryptText } from "../src/encryption.js";
import { parity } from "./parity.js";

const vector = parity.encryption;

describe("encryption", () => {
  it("derives the same key as the Python implementation", () => {
    expect(deriveKey(vector.security_key).toString("hex")).toBe(vector.derived_key_hex);
  });

  it("produces the Python ciphertext for a fixed nonce", () => {
    const key = deriveKey(vector.security_key);
    expect(encryptText(key, vector.plaintext, Buffer.from(vector.nonce_hex, "hex"))).toBe(vector.encrypted_fixed_nonce);
  });

  it("decrypts ciphertext produced by the Python implementation", () => {
    const key = deriveKey(vector.security_key);
    expect(decryptText(key, vector.encrypted_random_nonce)).toBe(vector.plaintext);
  });

  it("roundtrips with a fresh random nonce each time", () => {
    const key = deriveKey("TESTKEY");
    const first = encryptText(key, "abc");
    const second = encryptText(key, "abc");
    expect(first).not.toBe(second);
    expect(decryptText(key, first)).toBe("abc");
  });

  it("rejects ciphertext encrypted with a different key", () => {
    expect(() => decryptText(deriveKey("WRONG"), vector.encrypted_random_nonce)).toThrow();
  });
});
