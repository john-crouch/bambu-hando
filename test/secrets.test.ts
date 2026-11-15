// ABOUTME: Tests for API keys kept in the system keyring: store, read, remove, environment override, errors.
// ABOUTME: Runs against a private gnome-keyring on its own D-Bus session, never the login keyring; keyCommand.e2e covers an unreachable one.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { keyringName, loadSecret, removeSecret, SECRETS, secretByName, storedSecret, storeSecret, validateSecret } from "../src/secrets.js";
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
    expect(() => validateSecret("sk_live_abc123", TDFP)).toThrow("3DFilamentProfiles API keys start with 3dfp_: that doesn't look like one");
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
    await storeSecret(TDFP, "tdfp_abc123");
    expect(await storedSecret(TDFP)).toBe("tdfp_abc123");
    expect(await loadSecret(TDFP, {})).toEqual({ value: "tdfp_abc123", from: "keyring" });
  });

  it("replaces a stored key", async () => {
    await storeSecret(TDFP, "first");
    await storeSecret(TDFP, "second");
    expect(await storedSecret(TDFP)).toBe("second");
  });

  it("removes a stored key and says whether there was one", async () => {
    await storeSecret(TDFP, "tdfp_abc123");
    expect(await removeSecret(TDFP)).toBe(true);
    expect(await storedSecret(TDFP)).toBeNull();
    expect(await loadSecret(TDFP, {})).toBeNull();
    expect(await removeSecret(TDFP)).toBe(false);
  });

  it("lets the environment variable override the keyring", async () => {
    await storeSecret(TDFP, "from-keyring");
    expect(await loadSecret(TDFP, { [TDFP.env]: "from-env" })).toEqual({ value: "from-env", from: "env" });
  });

  it("ignores an empty environment variable", async () => {
    await storeSecret(TDFP, "from-keyring");
    expect(await loadSecret(TDFP, { [TDFP.env]: "  " })).toEqual({ value: "from-keyring", from: "keyring" });
  });
});
