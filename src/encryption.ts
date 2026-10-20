// ABOUTME: AES-256-GCM codec compatible with SpoolEase encrypted REST endpoints.
// ABOUTME: PBKDF2 parameters and nonce+ciphertext framing must match SpoolEase exactly.

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

export const DEFAULT_SALT = "example_salt";
export const DEFAULT_ITERATIONS = 10_000;

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
// base64 of a 12-byte nonce is exactly 16 characters with no padding.
const NONCE_CHARS = 16;

export function deriveKey(securityKey: string, salt = DEFAULT_SALT, iterations = DEFAULT_ITERATIONS): Buffer {
  return pbkdf2Sync(securityKey, salt, iterations, 32, "sha256");
}

function b64NoPad(data: Buffer): string {
  return data.toString("base64").replace(/=+$/, "");
}

/** Encrypt to no-pad base64(nonce) + no-pad base64(ciphertext || tag). */
export function encryptText(key: Buffer, plaintext: string, nonce: Buffer = randomBytes(NONCE_BYTES)): string {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final(), cipher.getAuthTag()]);
  return b64NoPad(nonce) + b64NoPad(ciphertext);
}

export function decryptText(key: Buffer, encrypted: string): string {
  const nonce = Buffer.from(encrypted.slice(0, NONCE_CHARS), "base64");
  const payload = Buffer.from(encrypted.slice(NONCE_CHARS), "base64");
  if (payload.length < TAG_BYTES) throw new Error("Encrypted payload is too short");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
  return Buffer.concat([decipher.update(payload.subarray(0, payload.length - TAG_BYTES)), decipher.final()]).toString("utf-8");
}
