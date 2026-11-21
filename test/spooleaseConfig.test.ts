// ABOUTME: Tests resolving the SpoolEase console (flags, environment, keyring, tui.json) and reading the SpoolEase
// ABOUTME: build of BambuStudio's spoolease/config.json; port, HTTPS and key follow the host's source (private keyring).

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidSecretError, removeSecret, SECRETS, storeSecret } from "../src/secrets.js";
import {
  consoleSettings,
  readSpoolEaseConfig,
  spooleaseConnectionFrom,
} from "../src/spooleaseConfig.js";
import { rememberConsole } from "../src/tuiSettings.js";
import { bambuConfigDir, installSpoolEaseConfig } from "./bambuStudioSetup.js";
import { type PrivateKeyring, privateKeyringSupported, startPrivateKeyring } from "./keyring.js";

// A private keyring for the whole file, started before any test reads one: the keyring module keeps its first
// D-Bus connection for the process's life. Without one, every read falls through as unreachable.
let keyring: PrivateKeyring | null = null;

beforeAll(async () => {
  if (privateKeyringSupported) keyring = await startPrivateKeyring();
});

afterAll(async () => {
  await keyring?.close();
});

describe("readSpoolEaseConfig", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-spoolease-config-"));
  });

  it("reads the console address and security key", async () => {
    await installSpoolEaseConfig(home, {
      address: "192.0.2.10",
      security_key: "SECRET",
      api_token: "TOKEN",
      ca_cert_pem: "",
    });

    expect(await readSpoolEaseConfig(bambuConfigDir(home))).toEqual({
      host: "192.0.2.10",
      securityKey: "SECRET",
    });
  });

  it.each([
    ["https://192.0.2.10/", "192.0.2.10"],
    ["http://spoolease.local/app/inventory", "spoolease.local"],
    ["  192.0.2.10:443 ", "192.0.2.10"],
  ])("reduces the address %j to the host %j", async (address, host) => {
    await installSpoolEaseConfig(home, { address, security_key: "SECRET" });

    expect((await readSpoolEaseConfig(bambuConfigDir(home))).host).toBe(host);
  });

  it("returns nulls for missing or empty fields", async () => {
    await installSpoolEaseConfig(home, { address: "", security_key: 42 });

    expect(await readSpoolEaseConfig(bambuConfigDir(home))).toEqual({
      host: null,
      securityKey: null,
    });
  });

  it("returns nulls when the file is missing or unreadable", async () => {
    expect(await readSpoolEaseConfig(bambuConfigDir(home))).toEqual({
      host: null,
      securityKey: null,
    });

    await mkdir(join(bambuConfigDir(home), "spoolease"), { recursive: true });
    await writeFile(join(bambuConfigDir(home), "spoolease", "config.json"), "{ not json", "utf-8");
    expect(await readSpoolEaseConfig(bambuConfigDir(home))).toEqual({
      host: null,
      securityKey: null,
    });
  });
});

describe("consoleSettings", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-console-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is empty, on port 80 without HTTPS, when nothing says otherwise", async () => {
    expect(await consoleSettings({}, {})).toEqual({
      host: "",
      port: "80",
      securityKey: "",
      https: false,
    });
  });

  it("takes tui.json's host before BambuStudio's, with tui.json's port and HTTPS", async () => {
    await installSpoolEaseConfig(home, { address: "10.0.0.9:8443", security_key: "FROM-BAMBU" });
    expect(await consoleSettings({}, {})).toEqual({
      host: "10.0.0.9",
      port: "80",
      securityKey: "FROM-BAMBU",
      https: false,
    });
    await rememberConsole({ host: "10.0.0.5", port: 8080, https: true });
    expect(await consoleSettings({}, {})).toMatchObject({
      host: "10.0.0.5",
      port: "8080",
      https: true,
    });
  });

  it("never pairs tui.json's console with BambuStudio's key, which belongs to another console", async () => {
    await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "FROM-BAMBU" });
    await rememberConsole({ host: "10.0.0.5", port: 8080, https: true });
    expect(await consoleSettings({}, {})).toEqual({
      host: "10.0.0.5",
      port: "8080",
      securityKey: "",
      https: true,
    });
  });

  it("never gives a host from a flag or the environment tui.json's port and HTTPS", async () => {
    await rememberConsole({ host: "10.0.0.5", port: 8080, https: true });
    expect(await consoleSettings({ "spoolease-host": "flag-host" }, {})).toEqual({
      host: "flag-host",
      port: "80",
      securityKey: "",
      https: false,
    });
    expect(await consoleSettings({}, { SPOOLEASE_HOST: "env-host" })).toMatchObject({
      host: "env-host",
      port: "80",
      https: false,
    });
  });

  it("never gives a host from a flag or the environment BambuStudio's key", async () => {
    await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "FROM-BAMBU" });
    expect(await consoleSettings({ "spoolease-host": "flag-host" }, {})).toMatchObject({
      securityKey: "",
    });
    expect(await consoleSettings({}, { SPOOLEASE_HOST: "env-host" })).toMatchObject({
      securityKey: "",
    });
  });

  it("takes port and HTTPS from the flags whatever the host's source, --no-spoolease-https included", async () => {
    await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "FROM-BAMBU" });
    const flags = { "spoolease-port": "81", "spoolease-https": true };
    expect(await consoleSettings(flags, {})).toMatchObject({ port: "81", https: true });
    await rememberConsole({ host: "10.0.0.5", port: 8080, https: true });
    expect(await consoleSettings({ "spoolease-https": false }, {})).toMatchObject({
      port: "8080",
      https: false,
    });
    expect(await consoleSettings({ ...flags, "spoolease-host": "h" }, {})).toMatchObject({
      port: "81",
      https: true,
    });
  });

  it("takes the key from the flag, then SPOOLEASE_SECURITY_KEY, whatever the host's source", async () => {
    await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "FROM-BAMBU" });
    const env = { SPOOLEASE_SECURITY_KEY: "env key" };
    expect(await consoleSettings({}, env)).toMatchObject({ securityKey: "env key" });
    expect(await consoleSettings({ "spoolease-security-key": "FROM-FLAG" }, env)).toMatchObject({
      securityKey: "FROM-FLAG",
    });
    await rememberConsole({ host: "10.0.0.5" });
    expect(await consoleSettings({}, env)).toMatchObject({ securityKey: "env key" });
    expect(await consoleSettings({ "spoolease-host": "h" }, env)).toMatchObject({
      securityKey: "env key",
    });
  });

  it("without the keyring, takes an unusable SPOOLEASE_SECURITY_KEY for no key instead of refusing it", async () => {
    const settings = await consoleSettings(
      { "spoolease-host": "h" },
      { SPOOLEASE_SECURITY_KEY: "LEAK\nME" },
      { keyring: false },
    );
    expect(settings).toEqual({ host: "h", port: "80", securityKey: "", https: false });
    expect(
      await consoleSettings({}, { SPOOLEASE_SECURITY_KEY: "env key" }, { keyring: false }),
    ).toMatchObject({ securityKey: "env key" });
  });

  describe.skipIf(!privateKeyringSupported)("with a key in the keyring", () => {
    beforeEach(async () => {
      for (const [name, value] of Object.entries(keyring?.env ?? {})) vi.stubEnv(name, value);
      await storeSecret(SECRETS.spoolease, "FROM-KEYRING");
    });

    afterEach(async () => {
      await removeSecret(SECRETS.spoolease);
    });

    it("uses it for tui.json's host, and for a host from a flag or the environment", async () => {
      await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "FROM-BAMBU" });
      expect(await consoleSettings({ "spoolease-host": "h" }, {})).toMatchObject({
        securityKey: "FROM-KEYRING",
      });
      expect(await consoleSettings({}, { SPOOLEASE_HOST: "h" })).toMatchObject({
        securityKey: "FROM-KEYRING",
      });
      await rememberConsole({ host: "10.0.0.5" });
      expect(await consoleSettings({}, {})).toMatchObject({
        host: "10.0.0.5",
        securityKey: "FROM-KEYRING",
      });
    });

    it("uses BambuStudio's key for BambuStudio's host, and the keyring's when BambuStudio has none", async () => {
      await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "FROM-BAMBU" });
      expect(await consoleSettings({}, {})).toMatchObject({
        host: "10.0.0.9",
        securityKey: "FROM-BAMBU",
      });
      await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "" });
      expect(await consoleSettings({}, {})).toMatchObject({
        host: "10.0.0.9",
        securityKey: "FROM-KEYRING",
      });
    });

    it("never reads it without the keyring, an unusable one included", async () => {
      await rememberConsole({ host: "10.0.0.5" });
      expect(await consoleSettings({}, {}, { keyring: false })).toMatchObject({ securityKey: "" });
      await storeSecret(SECRETS.spoolease, "LEAK\tME");
      expect(await consoleSettings({}, {}, { keyring: false })).toMatchObject({ securityKey: "" });
      await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "" });
      await rememberConsole({ host: "" });
      expect(await consoleSettings({}, {}, { keyring: false })).toMatchObject({
        host: "10.0.0.9",
        securityKey: "",
      });
    });

    it("still prefers the flag and SPOOLEASE_SECURITY_KEY to it", async () => {
      await rememberConsole({ host: "10.0.0.5" });
      expect(await consoleSettings({}, { SPOOLEASE_SECURITY_KEY: "env key" })).toMatchObject({
        securityKey: "env key",
      });
      expect(await consoleSettings({ "spoolease-security-key": "F" }, {})).toMatchObject({
        securityKey: "F",
      });
    });
  });

  it("refuses an unusable SPOOLEASE_SECURITY_KEY, naming it without quoting it", async () => {
    const err: unknown = await consoleSettings({}, { SPOOLEASE_SECURITY_KEY: "LEAK\nME" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidSecretError);
    expect((err as Error).message).toContain("SPOOLEASE_SECURITY_KEY");
    expect((err as Error).message).not.toContain("LEAK");
  });
});

describe("spooleaseConnectionFrom", () => {
  const settings = { host: "h", port: "8080", securityKey: "k", https: true };

  it("makes the connection on the port given", () => {
    expect(spooleaseConnectionFrom(settings, 8080)).toEqual({
      host: "h",
      port: 8080,
      securityKey: "k",
      https: true,
    });
  });

  it("is null without both a host and a key", () => {
    expect(spooleaseConnectionFrom({ ...settings, host: "" }, 80)).toBeNull();
    expect(spooleaseConnectionFrom({ ...settings, securityKey: "" }, 80)).toBeNull();
  });
});
