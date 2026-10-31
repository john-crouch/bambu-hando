// ABOUTME: Integration tests for the headless CLI: flags, report format, and exit codes.
// ABOUTME: Runs main() in-process against a local SpoolEase server and a temporary HOME.

import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { SOURCE_FIXTURE } from "./parity.js";
import { SPOOLS_CATALOG, startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";
import { startSpoolmanDbServer, type SpoolmanDbServer } from "./spoolmanDbServer.js";
import { baseFilamentDir, installBambuStudio, installSpoolEaseConfig, X1C_04, X1C_06 } from "./bambuStudioSetup.js";

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(argv: string[]): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

describe("cli", () => {
  let server: SpoolEaseServer;
  let spoolmanDb: SpoolmanDbServer;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    await installBambuStudio(home, { presetFolder: "1234567890" });
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("SPOOLEASE_HOST", undefined);
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", undefined);
    server = await startSpoolEaseServer();
    spoolmanDb = await startSpoolmanDbServer();
    vi.stubEnv("SPOOLMANDB_URL", spoolmanDb.url);
  });

  afterEach(async () => {
    await server.close();
    await spoolmanDb.close();
  });

  const spooleaseArgs = (): string[] => [
    "--spoolease-host",
    "127.0.0.1",
    "--spoolease-port",
    String(server.port),
    "--spoolease-security-key",
    TEST_SECURITY_KEY,
  ];

  it("prints a snake_case JSON report and exits 0 when everything is written", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, "--skip-spools", ...spooleaseArgs()]);

    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ source: SOURCE_FIXTURE, dry_run: false, profiles_count: 3 });
    expect(report.bambu_preset_paths).toHaveLength(3);
    expect(report.results[0]).toEqual({
      profile_name: "PETG Red",
      filament_id: "PABC1234",
      bambu_status: "written",
      spoolease_status: "written",
      detail: "registered PABC1234",
    });
    expect(server.spools).toEqual([]);
  });

  it("creates one spool per filament by default", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).results[0].detail).toBe("registered PABC1234; spool 1 created");
    expect(server.spools.map((s) => s.slicer_filament)).toEqual(["PABC1234", "Pb1a2a16", "Pd73077d"]);
  });

  it("registers filaments without spools with --skip-spools", async () => {
    const { code } = await run(["--source", SOURCE_FIXTURE, "--skip-spools", ...spooleaseArgs()]);

    expect(code).toBe(0);
    expect(server.customFilaments?.split("\r\n")).toHaveLength(3);
    expect(server.spools).toEqual([]);
  });

  it("exits 0 with --skip-spoolease", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease"]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).results[0].spoolease_status).toBe("skipped");
    expect(server.requests).toEqual([]);
  });

  it("plans in dry-run without writing anything", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, "--dry-run", ...spooleaseArgs()]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).results[0]).toMatchObject({ bambu_status: "planned", spoolease_status: "planned" });
    await expect(readdir(join(home, ".config", "BambuStudio", "user"))).rejects.toThrow("ENOENT");
  });

  it("reads SpoolEase host and key from BambuStudio's SpoolEase settings", async () => {
    await installSpoolEaseConfig(home, { address: "127.0.0.1", security_key: TEST_SECURITY_KEY });

    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, "--spoolease-port", String(server.port)]);

    expect(code).toBe(0);
    expect(server.requests[0]?.path).toBe("/api/test-key");
    expect(stdout).not.toContain(TEST_SECURITY_KEY);
  });

  it("prefers flags and environment over BambuStudio's SpoolEase settings", async () => {
    await installSpoolEaseConfig(home, { address: "192.0.2.1", security_key: "WRONG" });
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", TEST_SECURITY_KEY);

    const { code } = await run(["--source", SOURCE_FIXTURE, "--spoolease-host", "127.0.0.1", "--spoolease-port", String(server.port)]);

    expect(code).toBe(0);
  });

  it("reads SpoolEase host and key from the environment", async () => {
    vi.stubEnv("SPOOLEASE_HOST", "127.0.0.1");
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", TEST_SECURITY_KEY);

    const { code } = await run(["--source", SOURCE_FIXTURE, "--spoolease-port", String(server.port)]);

    expect(code).toBe(0);
    expect(server.requests[0]?.path).toBe("/api/test-key");
  });

  it("exits 1 when a spool write fails", async () => {
    server.replies["/api/spools/add-edit"] = { status: 500, body: "boom" };

    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);

    expect(code).toBe(1);
    expect(JSON.parse(stdout).results[0]).toMatchObject({ spoolease_status: "failed", detail: "registered PABC1234; spool rejected: HTTP 500: boom" });
  });

  it("warns on stderr when the custom filaments CSV fails", async () => {
    server.replies["POST /api/filaments-config"] = { status: 500, body: "boom" };

    const { code, stderr } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);

    expect(code).toBe(1);
    expect(stderr).toBe("Failed to set custom filaments CSV: HTTP 500: boom\n");
  });

  it("exits 2 when the SpoolEase key is rejected", async () => {
    const { code, stdout, stderr } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--spoolease-host",
      "127.0.0.1",
      "--spoolease-port",
      String(server.port),
      "--spoolease-security-key",
      "WRONG",
    ]);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe("SpoolEase key validation failed\n");
  });

  it("keeps existing presets unless --overwrite-presets is set", async () => {
    const path = join(baseFilamentDir(home, "1234567890"), `PETG Red @${X1C_04}.json`);
    await run(["--source", SOURCE_FIXTURE, "--skip-spoolease"]);
    await writeFile(path, "{}\n", "utf-8");

    const kept = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease"]);
    expect(JSON.parse(kept.stdout).results[0]).toMatchObject({ bambu_status: "skipped" });
    expect(await readFile(path, "utf-8")).toBe("{}\n");

    const replaced = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease", "--overwrite-presets"]);
    expect(replaced.code).toBe(0);
    expect(JSON.parse(replaced.stdout).results[0]).toMatchObject({ bambu_status: "written" });
    expect(JSON.parse(await readFile(path, "utf-8")).filament_id).toBe("PABC1234");
  });

  it("writes the report to --report as well as stdout", async () => {
    const reportPath = join(home, "report.json");

    const { stdout } = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease", "--report", reportPath]);

    expect(await readFile(reportPath, "utf-8")).toBe(stdout);
  });

  it("syncs SpoolmanDB filaments that match the filters and caches the catalog", async () => {
    const { code, stdout, stderr } = await run(["--source", "spoolmandb", "--brand", "3dhojor", "--skip-spoolease"]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.source).toBe("spoolmandb");
    expect(report.results.map((r: { profile_name: string }) => r.profile_name)).toEqual([
      "3DHoJor ABS+ Brown",
      "3DHoJor PLA-CF Brown",
      "3DHoJor PLA Crystal Rainbow Flame",
    ]);
    expect(await readdir(join(home, ".cache", "bambu-hando"))).toContain("filaments.json");
  });

  it("registers SpoolmanDB filaments with their temperatures and spool weights", async () => {
    const { code } = await run(["--source", "spoolmandb", "--match", "polylite", ...spooleaseArgs()]);

    expect(code).toBe(0);
    expect(server.customFilaments).toBe("Peddfd02,Polymaker PolyLite™ PETG Black,230,240,PETG");
    expect(server.spools[0]).toMatchObject({ slicer_filament: "Peddfd02", weight_advertised: "1000", weight_core: "140" });
  });

  describe("empty spool weights", () => {
    beforeEach(() => {
      server.spoolsCatalog = SPOOLS_CATALOG;
    });

    it("takes a brand's only SpoolEase catalog row and says so on stderr", async () => {
      const { code, stderr } = await run(["--source", "spoolmandb", "--brand", "RatRig", ...spooleaseArgs()]);

      expect(code).toBe(0);
      expect(stderr).toBe("RatRig: empty spool weight 220 g from SpoolEase (RatRig - Plastic - 220g)\n");
      expect(server.spools[0]).toMatchObject({ brand: "RatRig", weight_core: "220" });
    });

    it("lists the catalog rows and exits 2 before writing when a brand has several", async () => {
      const { code, stdout, stderr } = await run(["--source", "spoolmandb", "--brand", "Polymaker", "--dry-run", ...spooleaseArgs()]);

      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe(
        [
          "bambu-hando: error: SpoolEase lists several empty spool weights for these brands; run again with the --spool-weight you want:",
          "  Polymaker (1 filament; SpoolmanDB: 140 g)",
          '    --spool-weight "Polymaker=137"  PolyMaker - Cardboard - 137g',
          '    --spool-weight "Polymaker=149"  PolyMaker - Cardboard - 149g',
          '    --spool-weight "Polymaker=220"  PolyMaker - Plastic - 220g',
          '    --spool-weight "Polymaker=245"  PolyMaker - Plastic - 245g',
          '    --spool-weight "Polymaker=139"  Polymaker PolyTerra PLA - 139g',
          '    --spool-weight "Polymaker=147"  Polymaker PolyTerra PLA (Cardboard Spool) - 147g',
          "",
        ].join("\n"),
      );
      expect(server.requests.map((r) => r.path)).toEqual(["/api/test-key", "/api/spools-config", "/spools-catalog"]);
      await expect(readdir(join(home, ".config", "BambuStudio", "user"))).rejects.toThrow("ENOENT");
    });

    it("lists the user's own spools first and marks them", async () => {
      server.userSpools = "Polymaker weighed on my scale,151";

      const { stderr } = await run(["--source", "spoolmandb", "--brand", "Polymaker", "--dry-run", ...spooleaseArgs()]);

      expect(stderr).toContain(
        '  Polymaker (1 filament; SpoolmanDB: 140 g)\n    --spool-weight "Polymaker=151"  Polymaker weighed on my scale (My Spools List)\n',
      );
    });

    it("uses the weight chosen with --spool-weight", async () => {
      const { code } = await run(["--source", "spoolmandb", "--brand", "Polymaker", "--spool-weight", "polymaker=149", ...spooleaseArgs()]);

      expect(code).toBe(0);
      expect(server.spools[0]).toMatchObject({ brand: "Polymaker", weight_core: "149" });
    });

    it("keeps SpoolmanDB's weight for brands the catalog doesn't list, unless told unspecified", async () => {
      await run(["--source", "spoolmandb", "--match", "3DHoJor Brown ABS+", ...spooleaseArgs()]);
      expect(server.spools[0]).toMatchObject({ brand: "3DHoJor", weight_core: "169" });

      await run(["--source", "spoolmandb", "--match", "3DHoJor Brown PLA-CF", "--spool-weight", "3DHoJor=unspecified", ...spooleaseArgs()]);
      expect(server.spools[1]).toMatchObject({ brand: "3DHoJor", weight_core: "" });
    });

    it("warns and keeps SpoolmanDB's weights when the catalog can't be read", async () => {
      server.replies["GET /spools-catalog"] = { status: 404, body: "not found" };

      const { code, stderr } = await run(["--source", "spoolmandb", "--brand", "Polymaker", ...spooleaseArgs()]);

      expect(code).toBe(0);
      expect(stderr).toBe("Couldn't read the spool catalog from SpoolEase: HTTP 404: not found\n");
      expect(server.spools[0]).toMatchObject({ weight_core: "140" });
    });

    it("doesn't read spool weights when no spools are created", async () => {
      await run(["--source", "spoolmandb", "--brand", "Polymaker", "--skip-spools", ...spooleaseArgs()]);

      expect(server.requests.map((r) => r.path)).not.toContain("/spools-catalog");
    });

    it("exits 2 for a --spool-weight brand none of the filaments has", async () => {
      const { code, stderr } = await run(["--source", "spoolmandb", "--brand", "RatRig", "--spool-weight", "Sunlu=165", ...spooleaseArgs()]);

      expect(code).toBe(2);
      expect(stderr).toBe('bambu-hando: error: --spool-weight "Sunlu=165": none of the filaments is from Sunlu\n');
      expect(server.spools).toEqual([]);
    });
  });

  it("warns on stderr and uses the cached catalog when SpoolmanDB is down", async () => {
    await run(["--source", "spoolmandb", "--brand", "RatRig", "--skip-spoolease"]);
    spoolmanDb.failWith = 503;

    const { code, stdout, stderr } = await run(["--source", "spoolmandb", "--brand", "RatRig", "--skip-spoolease"]);

    expect(code).toBe(0);
    expect(stderr).toContain("SpoolmanDB filaments.json could not be refreshed (HTTP 503)");
    expect(JSON.parse(stdout).profiles_count).toBe(1);
  });

  it("exits 2 when no SpoolmanDB filament matches", async () => {
    const { code, stdout, stderr } = await run(["--source", "spoolmandb", "--brand", "Bambu Lab", "--skip-spoolease"]);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "bambu-hando: error: no SpoolmanDB filaments match the filters (Bambu Lab filaments are never included: BambuStudio ships its own presets for them)\n",
    );
  });

  it("writes to BambuStudio's logged-in preset folder for its selected printer by default", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease"]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).bambu_preset_paths[0]).toBe(join(baseFilamentDir(home, "1234567890"), `PETG Red @${X1C_04}.json`));
  });

  it("writes one preset per --printer-preset", async () => {
    const { code, stdout } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--skip-spoolease",
      "--preset-folder",
      "default",
      "--printer-preset",
      X1C_04,
      "--printer-preset",
      X1C_06,
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).bambu_preset_paths).toHaveLength(6);
    expect(await readdir(baseFilamentDir(home, "default"))).toHaveLength(6);
  });

  it("exits 2 for a printer BambuStudio doesn't know", async () => {
    const { code, stdout, stderr } = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease", "--printer-preset", "Bambu Lab X1C 0.4 nozzle"]);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(`bambu-hando: error: unknown BambuStudio printer "Bambu Lab X1C 0.4 nozzle"; known printers: ${X1C_04}, ${X1C_06}\n`);
  });

  it.each([
    [["--source", "spoolmandb", "--skip-spoolease"], "--source spoolmandb needs at least one of --brand, --material, --match"],
    [["--source", SOURCE_FIXTURE, "--brand", "Polymaker", "--skip-spoolease"], "--brand, --material, --match and --diameter only apply to --source spoolmandb"],
    [["--source", "spoolmandb", "--brand", "Polymaker", "--diameter", "thick", "--skip-spoolease"], "--diameter must be a positive number"],
    [[], "--source is required"],
    [
      ["--source", SOURCE_FIXTURE],
      "SpoolEase host and security key are required unless --skip-spoolease is set: pass --spoolease-host and --spoolease-security-key, set SPOOLEASE_HOST and SPOOLEASE_SECURITY_KEY, or configure SpoolEase in BambuStudio",
    ],
    [["--source", SOURCE_FIXTURE, "--skip-spoolease", "--spoolease-port", "eighty"], "--spoolease-port must be a port number"],
    [["--source", SOURCE_FIXTURE, "--bogus"], "Unknown option '--bogus'"],
    [["--source", SOURCE_FIXTURE, "--skip-spoolease", "--spool-weight", "Sunlu"], '--spool-weight takes <brand>=<grams|spoolmandb|unspecified>, got "Sunlu"'],
    [["--source", SOURCE_FIXTURE, "--skip-spoolease", "--spool-weight", "Sunlu=165"], "--spool-weight only applies when SpoolEase spools are created"],
    [["frobnicate"], "unknown command 'frobnicate'"],
  ])("exits 2 with usage for invalid arguments %j", async (argv, message) => {
    const { code, stdout, stderr } = await run(argv);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain(`bambu-hando: error: ${message}`);
    expect(stderr).toContain("Usage:");
  });

  it("exits 1 with a message when the source cannot be loaded", async () => {
    const { code, stderr } = await run(["--source", join(home, "missing.json"), "--skip-spoolease"]);

    expect(code).toBe(1);
    expect(stderr).toMatch(/^bambu-hando: error: ENOENT/);
  });

  it("prints usage with --help", async () => {
    const { code, stdout } = await run(["--help"]);

    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("bambu-hando tui");
  });

  it("refuses to start the TUI without an interactive terminal", async () => {
    const { code, stderr } = await run(["tui"]);

    expect(code).toBe(2);
    expect(stderr).toContain("bambu-hando tui needs an interactive terminal");
  });
});
