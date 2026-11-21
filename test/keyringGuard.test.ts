// ABOUTME: Tests the guard that keeps every test away from the login keyring, on every OS: in-process keyring calls
// ABOUTME: reach only a private keyring, and spawned commands must be handed each key they would look up.

import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyringError, SECRETS, storedSecret } from "../src/secrets.js";
import { assertNoLoginKeyring, LOGIN_KEYRING_OFF_LIMITS } from "./keyringGuard.js";

describe("in-process keyring calls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never reach a keyring other than a private one, whatever the bus says", async () => {
    // Checked first, so a missing guard fails here instead of trying a real keyring below.
    const keyring: Record<string, unknown> = await import("@napi-rs/keyring");
    expect(keyring.loginKeyringGuarded).toBe(true);
    // Addresses with nothing behind them, so even a broken guard couldn't reach a real keyring here.
    for (const address of [process.env.DBUS_SESSION_BUS_ADDRESS, "unix:path=/nonexistent/bus"]) {
      vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", address);
      const err: unknown = await storedSecret(SECRETS.spoolease).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KeyringError);
      expect((err as Error).message).toContain(LOGIN_KEYRING_OFF_LIMITS);
    }
  });
});

describe("assertNoLoginKeyring", () => {
  const key = { SPOOLEASE_SECURITY_KEY: "k" };

  it("refuses a command that would look the console's key up in the keyring", () => {
    for (const args of [
      ["tui"],
      ["tui", "--skip-spoolease"],
      ["labels", "--all", "--output", "x.pdf"],
      ["check"],
      ["--source", "x.json"],
      ["3dfp", "sync"],
    ])
      expect(() =>
        assertNoLoginKeyring(args, {
          FILAMENTPROFILES_API_KEY: "3dfp_x",
          SPOOLEASE_SECURITY_KEY: " ",
        }),
      ).toThrow(/SPOOLEASE_SECURITY_KEY/);
  });

  it("takes the console's key from the environment or a flag, or a headless run without SpoolEase", () => {
    expect(() => assertNoLoginKeyring(["tui"], key)).not.toThrow();
    expect(() =>
      assertNoLoginKeyring(["check", "--spoolease-security-key", "k"], {}),
    ).not.toThrow();
    expect(() => assertNoLoginKeyring(["labels", "--spoolease-security-key=k"], {})).not.toThrow();
    expect(() =>
      assertNoLoginKeyring(["--source", "x.json", "--skip-spoolease"], {}),
    ).not.toThrow();
  });

  it("wants the 3DFilamentProfiles key for 3dfp commands", () => {
    expect(() => assertNoLoginKeyring(["3dfp", "spools"], {})).toThrow(/FILAMENTPROFILES_API_KEY/);
    expect(() => assertNoLoginKeyring(["3dfp", "sync"], key)).toThrow(/FILAMENTPROFILES_API_KEY/);
    expect(() =>
      assertNoLoginKeyring(["3dfp", "sync"], { ...key, FILAMENTPROFILES_API_KEY: "3dfp_x" }),
    ).not.toThrow();
  });

  it("lets help through, and key commands only on a bus that can't be the login one (Linux)", () => {
    expect(() => assertNoLoginKeyring(["tui", "--help"], {})).not.toThrow();
    expect(() => assertNoLoginKeyring(["key", "status"], key)).toThrow(/login keyring/);
    const nowhere = { DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/bus" };
    if (process.platform === "linux")
      expect(() => assertNoLoginKeyring(["key", "status"], nowhere)).not.toThrow();
    else expect(() => assertNoLoginKeyring(["key", "status"], nowhere)).toThrow(/login keyring/);
  });
});
