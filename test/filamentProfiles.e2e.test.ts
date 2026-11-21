// ABOUTME: End-to-end test for `bambu-hando 3dfp` in the built binary against a local 3DFilamentProfiles stand-in.
// ABOUTME: Checks the quota and spool cache files land in the user's dirs and the key never reaches the output.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cacheDir, configDir } from "../src/paths.js";
import {
  type FilamentProfilesServer,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

describe("bambu-hando 3dfp (binary)", () => {
  let server: FilamentProfilesServer;
  let home: string;

  beforeEach(async () => {
    server = await startFilamentProfilesServer();
    server.spools = [serverSpool()];
    home = await mkdtemp(join(tmpdir(), "bh-3dfp-e2e-"));
  });

  afterEach(async () => {
    await server.close();
  });

  function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: home,
      FILAMENTPROFILES_API_KEY: TEST_API_KEY,
      FILAMENTPROFILES_API_URL: server.url,
    };
    return new Promise((resolve) => {
      execFile(process.execPath, [BIN, ...args], { env }, (err, stdout, stderr) =>
        resolve({ code: err ? Number(err.code) : 0, stdout, stderr }),
      );
    });
  }

  it("lists spools, then reports the quota from what it recorded", async () => {
    const spools = await cli(["3dfp", "spools"]);
    expect(spools).toMatchObject({ code: 0, stderr: "" });
    expect(spools.stdout).toContain("ABC123  Sunlu PETG Vivid Yellow  740 g  Shelf A");

    const usage = await cli(["3dfp", "usage"]);
    expect(usage.stdout).toMatch(/^3DFilamentProfiles API: 999 of 1000 calls left this month/);
    expect(server.requests).toHaveLength(1);

    const quotaFile = join(configDir(process.platform, home, {}), "3dfp-quota.json");
    expect(JSON.parse(await readFile(quotaFile, "utf-8"))).toMatchObject({
      remaining: 999,
      exact: true,
    });
    expect((await stat(quotaFile)).mode & 0o777).toBe(0o600);
    const cached = await readFile(
      join(cacheDir(process.platform, home, {}), "3dfp", "spools.json"),
      "utf-8",
    );
    expect(cached).toContain("ABC123");
    for (const text of [spools.stdout, usage.stdout, cached, await readFile(quotaFile, "utf-8")])
      expect(text).not.toContain(TEST_API_KEY);
  });
});
