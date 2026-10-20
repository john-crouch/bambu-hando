// ABOUTME: End-to-end tests that spawn the built bambu-hando binary as a real process.
// ABOUTME: Requires `npm run build` first (the npm test script does this).

import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { expectedPreset, expectedSpoolPayload, parity, SOURCE_FIXTURE } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

function spawnCli(args: string[], home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH ?? "", HOME: home } }, (err, stdout, stderr) => {
      resolve({ code: err ? Number(err.code) : 0, stdout, stderr });
    });
  });
}

describe("bambu-hando binary", () => {
  let server: SpoolEaseServer;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-e2e-"));
    server = await startSpoolEaseServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("syncs presets to disk and spools to SpoolEase", async () => {
    const { code, stdout, stderr } = await spawnCli(
      [
        "--source",
        SOURCE_FIXTURE,
        "--printer-preset",
        parity.printer_preset,
        "--spoolease-host",
        "127.0.0.1",
        "--spoolease-port",
        String(server.port),
        "--spoolease-security-key",
        TEST_SECURITY_KEY,
      ],
      home,
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(await readFile(report.bambu_preset_paths[0], "utf-8")).toBe(expectedPreset(0));
    expect(report.bambu_preset_paths[0].startsWith(join(home, ".config", "BambuStudio"))).toBe(true);
    expect(server.requests.filter((r) => r.path === "/api/spools/add-edit").map((r) => r.body)).toEqual([0, 1, 2].map(expectedSpoolPayload));
  });

  it("exits 2 for invalid arguments", async () => {
    const { code, stderr } = await spawnCli([], home);

    expect(code).toBe(2);
    expect(stderr).toContain("--source is required");
  });
});
