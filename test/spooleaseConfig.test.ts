// ABOUTME: Tests reading the SpoolEase console address and security key from the SpoolEase build
// ABOUTME: of BambuStudio (spoolease/config.json), the last fallback after flags and environment.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { readSpoolEaseConfig, spooleaseConnectionFrom } from "../src/spooleaseConfig.js";
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

describe("spooleaseConnectionFrom", () => {
  const saved = { host: "saved-host", securityKey: "saved-key" };
  const flags = { "spoolease-https": false };

  it("takes flags, then the environment, then BambuStudio's saved settings", () => {
    expect(
      spooleaseConnectionFrom(
        { ...flags, "spoolease-host": "flag-host", "spoolease-security-key": "flag-key" },
        80,
        saved,
        { SPOOLEASE_HOST: "env-host" },
      ),
    ).toEqual({
      host: "flag-host",
      securityKey: "flag-key",
      port: 80,
      https: false,
    });
    expect(
      spooleaseConnectionFrom(flags, 8080, saved, {
        SPOOLEASE_HOST: "env-host",
        SPOOLEASE_SECURITY_KEY: "env-key",
      }),
    ).toMatchObject({ host: "env-host", securityKey: "env-key", port: 8080 });
    expect(spooleaseConnectionFrom({ "spoolease-https": true }, 443, saved, {})).toEqual({
      host: "saved-host",
      securityKey: "saved-key",
      port: 443,
      https: true,
    });
  });

  it("is null without both a host and a key", () => {
    expect(
      spooleaseConnectionFrom(flags, 80, { host: "saved-host", securityKey: null }, {}),
    ).toBeNull();
    expect(
      spooleaseConnectionFrom(
        flags,
        80,
        { host: null, securityKey: null },
        { SPOOLEASE_SECURITY_KEY: "env-key" },
      ),
    ).toBeNull();
  });
});
