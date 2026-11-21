// ABOUTME: Tests for API keys kept in the system keyring: store, read, remove, environment override, errors.
// ABOUTME: Runs against a private gnome-keyring on its own D-Bus session, never the login keyring; keyCommand.e2e covers an unreachable one.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writesSettled } from "../src/pendingWrites.js";
import {
  holdsSecret,
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
const CONSOLE = SECRETS.spoolease;

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

describe("the SpoolEase security key", () => {
  it("is kept like the 3DFilamentProfiles key, under its own account and variable", () => {
    expect(CONSOLE).toEqual({
      name: "spoolease",
      label: "SpoolEase security key",
      account: "spoolease-security-key",
      env: "SPOOLEASE_SECURITY_KEY",
      prefix: "",
      spaces: true,
    });
  });

  it("takes any key without control characters, spaces inside included, since it has no prefix", () => {
    expect(validateSecret("anything-goes_123\n", CONSOLE)).toBe("anything-goes_123");
    expect(validateSecret("two words", CONSOLE)).toBe("two words");
    expect(() => validateSecret(" \n", CONSOLE)).toThrow(/empty/);
    for (const bad of ["abc\ndef", "abc\tdef", "abc\u0007def"]) {
      expect(() => validateSecret(bad, CONSOLE)).toThrow(
        "the key contains control characters: paste only the key",
      );
    }
  });

  it("keeps the key as typed, surrounding spaces included, dropping only the line end a paste or pipe adds", () => {
    expect(validateSecret("  two words \n", CONSOLE)).toBe("  two words ");
    expect(validateSecret(" key\r\n", CONSOLE)).toBe(" key");
    expect(validateSecret("key\n\n", CONSOLE)).toBe("key");
    expect(() => validateSecret("\tkey", CONSOLE)).toThrow(/control characters/);
  });

  it("keeps SPOOLEASE_SECURITY_KEY as set, surrounding spaces included", async () => {
    expect(await loadSecret(CONSOLE, { [CONSOLE.env]: " spaced key " })).toEqual({
      value: " spaced key ",
      from: "env",
    });
  });

  it("still refuses spaces inside a 3DFilamentProfiles key", () => {
    expect(() => validateSecret("3dfp_two words", TDFP)).toThrow(/spaces or control characters/);
  });

  it("refuses a mangled one in SPOOLEASE_SECURITY_KEY, naming the variable without echoing it", async () => {
    const err: unknown = await loadSecret(CONSOLE, { [CONSOLE.env]: "LEAK\tME" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidSecretError);
    expect((err as Error).message).toMatch(
      /^SPOOLEASE_SECURITY_KEY doesn't hold a usable SpoolEase security key: /,
    );
    expect((err as Error).message).not.toContain("LEAK");
  });
});

describe("holdsSecret", () => {
  it("spots a key with a prefix anywhere in an argument", () => {
    expect(holdsSecret("--key=3dfp_abc")).toBe(true);
  });

  it("doesn't take every argument for a key because one key has no prefix", () => {
    for (const arg of ["set", "spoolease", "--spoolease-host=10.0.0.5", ""])
      expect(holdsSecret(arg)).toBe(false);
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
  it("finds the 3DFilamentProfiles and SpoolEase keys and nothing else", () => {
    expect(secretByName("3dfp")).toBe(TDFP);
    expect(secretByName("spoolease")).toBe(CONSOLE);
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
    await removeSecret(CONSOLE);
    vi.unstubAllEnvs();
  });

  it("keeps the SpoolEase key apart from the 3DFilamentProfiles one", async () => {
    await storeSecret(TDFP, "3dfp_abc123");
    await storeSecret(CONSOLE, "console-key");
    expect(await loadSecret(CONSOLE, {})).toEqual({ value: "console-key", from: "keyring" });
    expect(await storedSecret(TDFP)).toBe("3dfp_abc123");
    expect(await removeSecret(CONSOLE)).toBe(true);
    expect(await storedSecret(TDFP)).toBe("3dfp_abc123");
  });

  it("reads the SpoolEase key back as it was stored, surrounding spaces included", async () => {
    await storeSecret(CONSOLE, " spaced key ");
    expect(await loadSecret(CONSOLE, {})).toEqual({ value: " spaced key ", from: "keyring" });
  });

  it("refuses a mangled SpoolEase key in the keyring, says how to replace it, and never echoes it", async () => {
    await storeSecret(CONSOLE, "LEAK\tME");
    const err: unknown = await loadSecret(CONSOLE, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidSecretError);
    expect((err as Error).message).toMatch(
      /^the SpoolEase security key stored in .* isn't usable: .*bambu-hando key set spoolease/,
    );
    expect((err as Error).message).not.toContain("LEAK");
  });

  it("stores a key and reads it back from the keyring", async () => {
    await storeSecret(TDFP, "3dfp_abc123");
    expect(await storedSecret(TDFP)).toBe("3dfp_abc123");
    expect(await loadSecret(TDFP, {})).toEqual({ value: "3dfp_abc123", from: "keyring" });
  });

  it("tracks storing and removing as writes, so the binary lets them finish before it exits", async () => {
    let stored = false;
    void storeSecret(TDFP, "3dfp_unawaited").then(() => {
      stored = true;
    });
    await writesSettled();
    expect(stored).toBe(true);
    let removed = false;
    void removeSecret(TDFP).then(() => {
      removed = true;
    });
    await writesSettled();
    expect(removed).toBe(true);
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
