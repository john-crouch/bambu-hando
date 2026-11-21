// ABOUTME: Tests resolving the SpoolEase console (flags, environment, keyring, tui.json) and reading the SpoolEase
// ABOUTME: build of BambuStudio's spoolease/config.json, the last fallback; keyring precedence is in cli.test.ts.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidSecretError } from "../src/secrets.js";
import {
  consoleSettings,
  readSpoolEaseConfig,
  spooleaseConnectionFrom,
} from "../src/spooleaseConfig.js";
import { rememberConsole } from "../src/tuiSettings.js";
import { bambuConfigDir, installSpoolEaseConfig } from "./bambuStudioSetup.js";

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

  it("takes tui.json's console before BambuStudio's, and BambuStudio's key", async () => {
    await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "FROM-BAMBU" });
    expect(await consoleSettings({}, {})).toMatchObject({
      host: "10.0.0.9",
      securityKey: "FROM-BAMBU",
    });
    await rememberConsole({ host: "10.0.0.5", port: 8080, https: true });
    expect(await consoleSettings({}, {})).toEqual({
      host: "10.0.0.5",
      port: "8080",
      securityKey: "FROM-BAMBU",
      https: true,
    });
  });

  it("takes flags and the environment before anything saved, --no-spoolease-https included", async () => {
    await installSpoolEaseConfig(home, { address: "10.0.0.9", security_key: "FROM-BAMBU" });
    await rememberConsole({ host: "10.0.0.5", port: 8080, https: true });
    const env = { SPOOLEASE_HOST: "env-host", SPOOLEASE_SECURITY_KEY: "env key" };
    expect(await consoleSettings({ "spoolease-https": false }, env)).toEqual({
      host: "env-host",
      port: "8080",
      securityKey: "env key",
      https: false,
    });
    expect(
      await consoleSettings(
        {
          "spoolease-host": "flag-host",
          "spoolease-port": "81",
          "spoolease-security-key": "FROM-FLAG",
          "spoolease-https": true,
        },
        env,
      ),
    ).toEqual({ host: "flag-host", port: "81", securityKey: "FROM-FLAG", https: true });
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
