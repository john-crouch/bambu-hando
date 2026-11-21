// ABOUTME: Tests for API keys kept in the system keyring: store, read, remove, environment override, errors.
// ABOUTME: Runs against a private gnome-keyring on its own D-Bus session, never the login keyring; keyCommand.e2e covers an unreachable one.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InvalidSecretError,
  keyringName,
  loadSecret,
  removeSecret,
  SECRETS,
  secretByName,
  storedSecret,
  storeSecret,
  validateSecret,
} from "../src/secrets.js";
import { type PrivateKeyring, privateKeyringSupported, startPrivateKeyring } from "./keyring.js";

const TDFP = SECRETS["3dfp"];

describe("validateSecret", () => {
  it("trims surrounding whitespace, such as the newline a paste or pipe adds", () => {
    expect(validateSecret("  tdfp_abc123\n")).toBe("tdfp_abc123");
  });

  it("rejects an empty key", () => {
    expect(() => validateSecret(" \n")).toThrow(/empty/);
  });

  it("rejects whitespace or control characters inside the key, without echoing it", () => {
    for (const bad of ["abc def", "abc\ndef", "abc\u0007def"]) {
      expect(() => validateSecret(bad)).toThrow(/spaces or control characters/);
      expect(() => validateSecret(bad)).not.toThrow(/abc/);
    }
  });
});

describe("validateSecret with a key's prefix", () => {
  it("accepts a key with its documented prefix", () => {
    expect(validateSecret(" 3dfp_abc123\n", TDFP)).toBe("3dfp_abc123");
  });

  it("rejects something else pasted by mistake, without echoing it", () => {
    expect(() => validateSecret("sk_live_abc123", TDFP)).toThrow(
      "3DFilamentProfiles API keys start with 3dfp_: that doesn't look like one",
    );
  });
});

describe("loadSecret from the environment", () => {
  it("refuses a mangled or wrong key, naming the variable without echoing the value", async () => {
    for (const value of ["3dfp_LEAK\nME", "sk_live_LEAKME"]) {
      const err: unknown = await loadSecret(TDFP, { [TDFP.env]: value }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidSecretError);
      expect((err as Error).message).toMatch(
        /^FILAMENTPROFILES_API_KEY doesn't hold a usable 3DFilamentProfiles API key: /,
      );
      expect((err as Error).message).not.toContain("LEAK");
    }
  });
});

describe("secretByName", () => {
  it("finds the 3DFilamentProfiles key and nothing else", () => {
    expect(secretByName("3dfp")).toBe(TDFP);
    expect(secretByName("nope")).toBeUndefined();
    expect(secretByName("toString")).toBeUndefined();
  });
});

describe("keyringName", () => {
  it("names the store each platform uses", () => {
    expect(keyringName("darwin")).toBe("the macOS Keychain");
    expect(keyringName("linux")).toBe("the system keyring (Secret Service)");
  });
});

describe.skipIf(!privateKeyringSupported)("secrets in the system keyring", () => {
  let keyring: PrivateKeyring;

  beforeAll(async () => {
    keyring = await startPrivateKeyring();
  });

  afterAll(async () => {
    await keyring.close();
  });

  beforeEach(() => {
    for (const [name, value] of Object.entries(keyring.env)) vi.stubEnv(name, value);
  });

  afterEach(async () => {
    await removeSecret(TDFP);
    vi.unstubAllEnvs();
  });

  it("stores a key and reads it back from the keyring", async () => {
    await storeSecret(TDFP, "3dfp_abc123");
    expect(await storedSecret(TDFP)).toBe("3dfp_abc123");
    expect(await loadSecret(TDFP, {})).toEqual({ value: "3dfp_abc123", from: "keyring" });
  });

  it("replaces a stored key", async () => {
    await storeSecret(TDFP, "first");
    await storeSecret(TDFP, "second");
    expect(await storedSecret(TDFP)).toBe("second");
  });

  it("removes a stored key and says whether there was one", async () => {
    await storeSecret(TDFP, "3dfp_abc123");
    expect(await removeSecret(TDFP)).toBe(true);
    expect(await storedSecret(TDFP)).toBeNull();
    expect(await loadSecret(TDFP, {})).toBeNull();
    expect(await removeSecret(TDFP)).toBe(false);
  });

  it("lets the environment variable override the keyring", async () => {
    await storeSecret(TDFP, "3dfp_from_keyring");
    expect(await loadSecret(TDFP, { [TDFP.env]: "3dfp_from_env" })).toEqual({
      value: "3dfp_from_env",
      from: "env",
    });
  });

  it("ignores an empty environment variable", async () => {
    await storeSecret(TDFP, "3dfp_from_keyring");
    expect(await loadSecret(TDFP, { [TDFP.env]: "  " })).toEqual({
      value: "3dfp_from_keyring",
      from: "keyring",
    });
  });

  it("refuses a mangled key in the keyring, says how to replace it, and never echoes it", async () => {
    await storeSecret(TDFP, "3dfp_LEAK\nME");
    const err: unknown = await loadSecret(TDFP, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidSecretError);
    expect((err as Error).message).toMatch(
      /^the 3DFilamentProfiles API key stored in the system keyring \(Secret Service\) isn't usable: .*bambu-hando key set 3dfp/,
    );
    expect((err as Error).message).not.toContain("LEAK");
  });
});
