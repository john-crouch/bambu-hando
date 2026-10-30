// ABOUTME: End-to-end tests that spawn the built bambu-hando binary as a real process.
// ABOUTME: Requires `npm run build` first (the npm test script does this).

import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { baseFilamentDir, installBambuStudio, X1C_06 } from "./bambuStudioSetup.js";
import { expectedSpoolPayload, SOURCE_FIXTURE } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";
import { startSpoolmanDbServer } from "./spoolmanDbServer.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

function spawnCli(args: string[], home: string, env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH ?? "", HOME: home, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? Number(err.code) : 0, stdout, stderr });
    });
  });
}

describe("bambu-hando binary", () => {
  let server: SpoolEaseServer;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-e2e-"));
    await installBambuStudio(home, { presetFolder: "1234567890" });
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
        X1C_06,
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
    expect(report.bambu_preset_paths[0]).toBe(join(baseFilamentDir(home, "1234567890"), `PETG Red @${X1C_06}.json`));
    const preset = JSON.parse(await readFile(report.bambu_preset_paths[0], "utf-8"));
    expect(preset).toMatchObject({ filament_id: "PABC1234", inherits: "", compatible_printers: [X1C_06], filament_type: ["PETG"] });
    expect(server.requests.filter((r) => r.path === "/api/spools/add-edit").map((r) => r.body)).toEqual([0, 1, 2].map(expectedSpoolPayload));
  });

  it("downloads SpoolmanDB filaments and writes linked presets", async () => {
    const spoolmanDb = await startSpoolmanDbServer();
    try {
      const { code, stdout, stderr } = await spawnCli(["--source", "spoolmandb", "--match", "polylite", "--skip-spoolease"], home, {
        SPOOLMANDB_URL: spoolmanDb.url,
      });

      expect(stderr).toBe("");
      expect(code).toBe(0);
      const report = JSON.parse(stdout);
      const preset = JSON.parse(await readFile(report.bambu_preset_paths[0], "utf-8"));
      expect(preset).toMatchObject({ name: "Polymaker PolyLite™ PETG Black @Bambu Lab X1 Carbon 0.4 nozzle", filament_id: "Peddfd02" });
      expect(await readFile(join(home, ".cache", "bambu-hando", "filaments.json"), "utf-8")).toBe(spoolmanDb.files.get("/filaments.json"));
    } finally {
      await spoolmanDb.close();
    }
  });

  it("exits 2 for invalid arguments", async () => {
    const { code, stderr } = await spawnCli([], home);

    expect(code).toBe(2);
    expect(stderr).toContain("--source is required");
  });
});
