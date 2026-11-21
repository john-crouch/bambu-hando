// ABOUTME: Integration tests for the headless CLI: flags, report format, and exit codes.
// ABOUTME: Runs main() in-process against a local SpoolEase server and a temporary HOME.

import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { removeSecret, SECRETS, storeSecret } from "../src/secrets.js";
import { rememberConsole } from "../src/tuiSettings.js";
import {
  baseFilamentDir,
  installBambuStudio,
  installSpoolEaseConfig,
  X1C_04,
  X1C_06,
} from "./bambuStudioSetup.js";
import { installFakeLp } from "./fakeLp.js";
import { type PrivateKeyring, privateKeyringSupported, startPrivateKeyring } from "./keyring.js";
import { SOURCE_FIXTURE } from "./parity.js";
import { decodeQr, readPdf } from "./pdf.js";
import {
  SPOOLS_CATALOG,
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { type SpoolmanDbServer, startSpoolmanDbServer } from "./spoolmanDbServer.js";

const CONSOLE_KEY = SECRETS.spoolease;

// A private keyring for the whole file, started before any test reads one: the keyring module keeps
// its first D-Bus connection for the process's life. Without one, every read falls through as unreachable.
let keyring: PrivateKeyring | null = null;

beforeAll(async () => {
  if (privateKeyringSupported) keyring = await startPrivateKeyring();
});

afterAll(async () => {
  await keyring?.close();
});

beforeEach(() => {
  for (const [name, value] of Object.entries(keyring?.env ?? {})) vi.stubEnv(name, value);
});

afterEach(async () => {
  if (keyring) await removeSecret(CONSOLE_KEY);
});

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
    const { code, stdout } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--skip-spools",
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ source: SOURCE_FIXTURE, dry_run: false, profiles_count: 3 });
    expect(report.bambu_preset_paths).toHaveLength(3);
    expect(report.labels).toBeNull();
    expect(report.results[0]).toEqual({
      profile_name: "PETG Red",
      filament_id: "PABC1234",
      bambu_status: "written",
      spoolease_status: "written",
      detail: "registered PABC1234",
      core_weight_g: null,
      spool_id: null,
    });
    expect(server.spools).toEqual([]);
  });

  it("creates one spool per filament by default", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).results[0].detail).toBe("registered PABC1234; spool 1 created");
    expect(JSON.parse(stdout).results.map((r: { spool_id: string }) => r.spool_id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(server.spools.map((s) => s.slicer_filament)).toEqual([
      "PABC1234",
      "Pb1a2a16",
      "Pd73077d",
    ]);
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
    const { code, stdout } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--dry-run",
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).results[0]).toMatchObject({
      bambu_status: "planned",
      spoolease_status: "planned",
    });
    await expect(readdir(join(home, ".config", "BambuStudio", "user"))).rejects.toThrow("ENOENT");
  });

  it("reads SpoolEase host and key from BambuStudio's SpoolEase settings", async () => {
    await installSpoolEaseConfig(home, { address: "127.0.0.1", security_key: TEST_SECURITY_KEY });

    const { code, stdout } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--spoolease-port",
      String(server.port),
    ]);

    expect(code).toBe(0);
    expect(server.requests[0]?.path).toBe("/api/test-key");
    expect(stdout).not.toContain(TEST_SECURITY_KEY);
  });

  it("prefers flags and environment over BambuStudio's SpoolEase settings", async () => {
    await installSpoolEaseConfig(home, { address: "192.0.2.1", security_key: "WRONG" });
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", TEST_SECURITY_KEY);

    const { code } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--spoolease-host",
      "127.0.0.1",
      "--spoolease-port",
      String(server.port),
    ]);

    expect(code).toBe(0);
  });

  it.skipIf(!privateKeyringSupported)(
    "uses the console saved in Settings: the key from the keyring, host and port from tui.json",
    async () => {
      await storeSecret(CONSOLE_KEY, TEST_SECURITY_KEY);
      await rememberConsole({ host: "127.0.0.1", port: server.port });

      const { code, stdout, stderr } = await run(["--source", SOURCE_FIXTURE]);

      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      expect(server.requests[0]?.path).toBe("/api/test-key");
      expect(stdout).not.toContain(TEST_SECURITY_KEY);
    },
  );

  it.skipIf(!privateKeyringSupported)(
    "takes the key from the flag, then the environment, then the keyring, then BambuStudio",
    async () => {
      const port = ["--spoolease-port", String(server.port)];
      await installSpoolEaseConfig(home, { address: "127.0.0.1", security_key: "WRONG" });
      await storeSecret(CONSOLE_KEY, TEST_SECURITY_KEY);
      expect((await run(["--source", SOURCE_FIXTURE, ...port])).code).toBe(0);

      await storeSecret(CONSOLE_KEY, "WRONG-TOO");
      vi.stubEnv("SPOOLEASE_SECURITY_KEY", TEST_SECURITY_KEY);
      expect((await run(["--source", SOURCE_FIXTURE, ...port])).code).toBe(0);

      vi.stubEnv("SPOOLEASE_SECURITY_KEY", undefined);
      const flag = ["--spoolease-security-key", TEST_SECURITY_KEY];
      expect((await run(["--source", SOURCE_FIXTURE, ...port, ...flag])).code).toBe(0);

      // Neither: the keyring's wrong key is the one tried, and the console refuses it.
      const refused = await run(["--source", SOURCE_FIXTURE, ...port]);
      expect(refused.code).toBe(2);
      expect(refused.stdout + refused.stderr).not.toContain("WRONG-TOO");
    },
  );

  it("takes host, port and HTTPS from flags and environment before tui.json, and tui.json before BambuStudio", async () => {
    await installSpoolEaseConfig(home, { address: "192.0.2.1", security_key: TEST_SECURITY_KEY });
    await rememberConsole({ host: "127.0.0.1", port: server.port });
    expect((await run(["--source", SOURCE_FIXTURE])).code).toBe(0);

    // Nothing answers on port 1, so these only pass when the flag or variable wins.
    await rememberConsole({ host: "127.0.0.1", port: 1 });
    const port = ["--spoolease-port", String(server.port)];
    expect((await run(["--source", SOURCE_FIXTURE, ...port])).code).toBe(0);
    await rememberConsole({ host: "192.0.2.1", port: server.port });
    vi.stubEnv("SPOOLEASE_HOST", "127.0.0.1");
    expect((await run(["--source", SOURCE_FIXTURE])).code).toBe(0);
  });

  it.skipIf(!privateKeyringSupported)(
    "says a stored key isn't usable, naming the keyring and never quoting it",
    async () => {
      await storeSecret(CONSOLE_KEY, "LEAK\tME");
      const { code, stdout, stderr } = await run([
        "--source",
        SOURCE_FIXTURE,
        "--spoolease-host",
        "127.0.0.1",
      ]);
      expect(code).toBe(2);
      expect(stderr).toMatch(
        /the SpoolEase security key stored in .* isn't usable: .*bambu-hando key set spoolease/,
      );
      expect(stdout + stderr).not.toContain("LEAK");
      expect(server.requests).toEqual([]);
    },
  );

  it("says SPOOLEASE_SECURITY_KEY isn't usable without quoting it", async () => {
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", "LEAK\nME");
    const { code, stdout, stderr } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--spoolease-host",
      "127.0.0.1",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("SPOOLEASE_SECURITY_KEY doesn't hold a usable SpoolEase security key");
    expect(stdout + stderr).not.toContain("LEAK");
  });

  it("lets --no-spoolease-https switch off an HTTPS saved in Settings", async () => {
    await installSpoolEaseConfig(home, { address: "127.0.0.1", security_key: TEST_SECURITY_KEY });
    await rememberConsole({ port: server.port, https: true });
    // The stand-in speaks plain HTTP, so HTTPS can't reach it.
    expect((await run(["--source", SOURCE_FIXTURE, "--dry-run"])).code).toBe(2);
    const off = await run(["--source", SOURCE_FIXTURE, "--dry-run", "--no-spoolease-https"]);
    expect({ code: off.code, stderr: off.stderr }).toEqual({ code: 0, stderr: "" });
  });

  it("reads SpoolEase host and key from the environment", async () => {
    vi.stubEnv("SPOOLEASE_HOST", "127.0.0.1");
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", TEST_SECURITY_KEY);

    const { code } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--spoolease-port",
      String(server.port),
    ]);

    expect(code).toBe(0);
    expect(server.requests[0]?.path).toBe("/api/test-key");
  });

  it("exits 1 when a spool write fails", async () => {
    server.replies["/api/spools/add-edit"] = { status: 500, body: "boom" };

    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);

    expect(code).toBe(1);
    expect(JSON.parse(stdout).results[0]).toMatchObject({
      spoolease_status: "failed",
      detail: "registered PABC1234; spool rejected: HTTP 500: boom",
    });
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

    const replaced = await run([
      "--source",
      SOURCE_FIXTURE,
      "--skip-spoolease",
      "--overwrite-presets",
    ]);
    expect(replaced.code).toBe(0);
    expect(JSON.parse(replaced.stdout).results[0]).toMatchObject({ bambu_status: "written" });
    expect(JSON.parse(await readFile(path, "utf-8")).filament_id).toBe("PABC1234");
  });

  it("writes the report to --report as well as stdout", async () => {
    const reportPath = join(home, "report.json");

    const { stdout } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--skip-spoolease",
      "--report",
      reportPath,
    ]);

    expect(await readFile(reportPath, "utf-8")).toBe(stdout);
  });

  it("syncs SpoolmanDB filaments that match the filters and caches the catalog", async () => {
    const { code, stdout, stderr } = await run([
      "--source",
      "spoolmandb",
      "--brand",
      "3dhojor",
      "--skip-spoolease",
    ]);

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
    const { code } = await run([
      "--source",
      "spoolmandb",
      "--match",
      "polylite",
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(0);
    expect(server.customFilaments).toBe("Peddfd02,Polymaker PolyLite™ PETG Black,230,240,PETG");
    expect(server.spools[0]).toMatchObject({
      slicer_filament: "Peddfd02",
      weight_advertised: "1000",
      weight_core: "140",
    });
  });

  describe("empty spool weights", () => {
    beforeEach(() => {
      server.spoolsCatalog = SPOOLS_CATALOG;
    });

    it("takes a brand's only SpoolEase catalog row and says so on stderr", async () => {
      const { code, stderr } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "RatRig",
        ...spooleaseArgs(),
      ]);

      expect(code).toBe(0);
      expect(stderr).toBe(
        "RatRig: empty spool weight 220 g from SpoolEase (RatRig - Plastic - 220g)\n",
      );
      expect(server.spools[0]).toMatchObject({ brand: "RatRig", weight_core: "220" });
    });

    it("lists the catalog rows and exits 2 before writing when a brand has several", async () => {
      const { code, stdout, stderr } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "Polymaker",
        "--dry-run",
        ...spooleaseArgs(),
      ]);

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
      expect(server.requests.map((r) => r.path)).toEqual([
        "/api/test-key",
        "/api/spools-config",
        "/spools-catalog",
      ]);
      await expect(readdir(join(home, ".config", "BambuStudio", "user"))).rejects.toThrow("ENOENT");
    });

    it("names a source file, not SpoolmanDB, as where the listed weight comes from", async () => {
      const path = join(home, "polymaker.json");
      await writeFile(
        path,
        JSON.stringify({
          profiles: [
            {
              name: "Polymaker PETG Teal",
              brand: "Polymaker",
              material: "PETG",
              spool_weight: 180,
            },
          ],
        }),
        "utf-8",
      );

      const { code, stderr } = await run(["--source", path, "--dry-run", ...spooleaseArgs()]);

      expect(code).toBe(2);
      expect(stderr).toContain("  Polymaker (1 filament; Source file: 180 g)\n");
    });

    it("lists the user's own spools first and marks them", async () => {
      server.userSpools = "Polymaker weighed on my scale,151";

      const { stderr } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "Polymaker",
        "--dry-run",
        ...spooleaseArgs(),
      ]);

      expect(stderr).toContain(
        '  Polymaker (1 filament; SpoolmanDB: 140 g)\n    --spool-weight "Polymaker=151"  Polymaker weighed on my scale (My Spools List)\n',
      );
    });

    it("uses the weight chosen with --spool-weight", async () => {
      const { code, stdout } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "Polymaker",
        "--spool-weight",
        "polymaker=149",
        ...spooleaseArgs(),
      ]);

      expect(code).toBe(0);
      expect(server.spools[0]).toMatchObject({ brand: "Polymaker", weight_core: "149" });
      expect(JSON.parse(stdout).results[0].core_weight_g).toBe(149);
    });

    it("keeps SpoolmanDB's weight for brands the catalog doesn't list, unless told unspecified", async () => {
      await run(["--source", "spoolmandb", "--match", "3DHoJor Brown ABS+", ...spooleaseArgs()]);
      expect(server.spools[0]).toMatchObject({ brand: "3DHoJor", weight_core: "169" });

      await run([
        "--source",
        "spoolmandb",
        "--match",
        "3DHoJor Brown PLA-CF",
        "--spool-weight",
        "3DHoJor=unspecified",
        ...spooleaseArgs(),
      ]);
      expect(server.spools[1]).toMatchObject({ brand: "3DHoJor", weight_core: "" });
    });

    it("warns and keeps SpoolmanDB's weights when the catalog can't be read", async () => {
      server.replies["GET /spools-catalog"] = { status: 404, body: "not found" };

      const { code, stderr } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "Polymaker",
        ...spooleaseArgs(),
      ]);

      expect(code).toBe(0);
      expect(stderr).toBe("Couldn't read the spool catalog from SpoolEase: HTTP 404: not found\n");
      expect(server.spools[0]).toMatchObject({ weight_core: "140" });
    });

    it("doesn't read spool weights when no spools are created", async () => {
      await run([
        "--source",
        "spoolmandb",
        "--brand",
        "Polymaker",
        "--skip-spools",
        ...spooleaseArgs(),
      ]);

      expect(server.requests.map((r) => r.path)).not.toContain("/spools-catalog");
    });

    it("exits 2 for a --spool-weight brand none of the filaments has", async () => {
      const { code, stderr } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "RatRig",
        "--spool-weight",
        "Sunlu=165",
        ...spooleaseArgs(),
      ]);

      expect(code).toBe(2);
      expect(stderr).toBe(
        'bambu-hando: error: --spool-weight "Sunlu=165": none of the filaments is from Sunlu\n',
      );
      expect(server.spools).toEqual([]);
    });
  });

  it("warns on stderr and uses the cached catalog when SpoolmanDB is down", async () => {
    await run(["--source", "spoolmandb", "--brand", "RatRig", "--skip-spoolease"]);
    spoolmanDb.failWith = 503;

    const { code, stdout, stderr } = await run([
      "--source",
      "spoolmandb",
      "--brand",
      "RatRig",
      "--skip-spoolease",
    ]);

    expect(code).toBe(0);
    expect(stderr).toContain("SpoolmanDB filaments.json could not be refreshed (HTTP 503)");
    expect(JSON.parse(stdout).profiles_count).toBe(1);
  });

  it("exits 2 when no SpoolmanDB filament matches", async () => {
    const { code, stdout, stderr } = await run([
      "--source",
      "spoolmandb",
      "--brand",
      "Bambu Lab",
      "--skip-spoolease",
    ]);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "bambu-hando: error: no SpoolmanDB filaments match the filters (Bambu Lab filaments are never included: BambuStudio ships its own presets for them)\n",
    );
  });

  it("caps SpoolmanDB matches at --max-filaments", async () => {
    const { code, stderr } = await run([
      "--source",
      "spoolmandb",
      "--brand",
      "3dhojor",
      "--max-filaments",
      "2",
      "--skip-spoolease",
    ]);

    expect(code).toBe(2);
    expect(stderr).toContain(
      "3 SpoolmanDB filaments match the filters, more than --max-filaments (2):",
    );
    expect(stderr).toContain("pass --max-filaments 3 to sync them all");
  });

  describe("match cap", () => {
    const COLORS = [
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Blue",
      "Indigo",
      "Violet",
      "Black",
      "White",
      "Grey",
      "Brown",
    ];

    beforeEach(() => {
      spoolmanDb.files.set(
        "/filaments.json",
        JSON.stringify(
          COLORS.map((name) => ({
            manufacturer: "Acme",
            name,
            material: "PLA",
            diameter: 1.75,
            weight: 1000,
          })),
        ),
      );
    });

    it("exits 2 without writing anything when more than 10 filaments match", async () => {
      const { code, stdout, stderr } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "Acme",
        ...spooleaseArgs(),
      ]);

      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe(
        [
          "bambu-hando: error: 11 SpoolmanDB filaments match the filters, more than --max-filaments (10):",
          ...COLORS.slice(0, 10).map((color) => `  Acme PLA ${color}`),
          "  ...and 1 more",
          "Narrow the filters (for example with --match), or pass --max-filaments 11 to sync them all; --dry-run lists every match.",
          "",
        ].join("\n"),
      );
      expect(server.requests).toEqual([]);
      await expect(readdir(baseFilamentDir(home, "1234567890"))).rejects.toThrow();
    });

    it("syncs them all when --max-filaments allows it", async () => {
      const { code, stdout } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "Acme",
        "--max-filaments",
        "11",
        "--skip-spoolease",
      ]);

      expect(code).toBe(0);
      expect(JSON.parse(stdout).profiles_count).toBe(11);
    });

    it("doesn't cap a dry run", async () => {
      const { code, stdout } = await run([
        "--source",
        "spoolmandb",
        "--brand",
        "Acme",
        "--dry-run",
        "--skip-spoolease",
      ]);

      expect(code).toBe(0);
      expect(JSON.parse(stdout).profiles_count).toBe(11);
    });
  });

  it("writes to BambuStudio's logged-in preset folder for its selected printer by default", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease"]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).bambu_preset_paths[0]).toBe(
      join(baseFilamentDir(home, "1234567890"), `PETG Red @${X1C_04}.json`),
    );
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
    const { code, stdout, stderr } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--skip-spoolease",
      "--printer-preset",
      "Bambu Lab X1C 0.4 nozzle",
    ]);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      `bambu-hando: error: unknown BambuStudio printer "Bambu Lab X1C 0.4 nozzle"; known printers: ${X1C_04}, ${X1C_06}\n`,
    );
  });

  it.each([
    [
      ["--source", "spoolmandb", "--skip-spoolease"],
      "--source spoolmandb needs at least one of --brand, --material, --match",
    ],
    [
      ["--source", SOURCE_FIXTURE, "--brand", "Polymaker", "--skip-spoolease"],
      "--brand, --material, --match, --diameter and --max-filaments only apply to --source spoolmandb",
    ],
    [
      ["--source", SOURCE_FIXTURE, "--max-filaments", "20", "--skip-spoolease"],
      "--brand, --material, --match, --diameter and --max-filaments only apply to --source spoolmandb",
    ],
    [
      ["--source", "spoolmandb", "--brand", "Polymaker", "--diameter", "thick", "--skip-spoolease"],
      "--diameter must be a positive number",
    ],
    [
      [
        "--source",
        "spoolmandb",
        "--brand",
        "Polymaker",
        "--max-filaments",
        "0",
        "--skip-spoolease",
      ],
      "--max-filaments must be a whole number of at least 1",
    ],
    [
      [
        "--source",
        "spoolmandb",
        "--brand",
        "Polymaker",
        "--max-filaments",
        "ten",
        "--skip-spoolease",
      ],
      "--max-filaments must be a whole number of at least 1",
    ],
    [[], "--source is required"],
    [
      ["--source", SOURCE_FIXTURE],
      "SpoolEase host and security key are required unless --skip-spoolease is set: pass --spoolease-host and --spoolease-security-key, set SPOOLEASE_HOST and SPOOLEASE_SECURITY_KEY, save them in the TUI's Settings (the key also with bambu-hando key set spoolease), or configure SpoolEase in BambuStudio",
    ],
    [
      ["--source", SOURCE_FIXTURE, "--skip-spoolease", "--spoolease-port", "eighty"],
      "--spoolease-port must be a port number",
    ],
    [["--source", SOURCE_FIXTURE, "--bogus"], "Unknown option '--bogus'"],
    [
      ["--source", SOURCE_FIXTURE, "--skip-spoolease", "--spool-weight", "Sunlu"],
      '--spool-weight takes <brand>=<grams|spoolmandb|unspecified>, got "Sunlu"',
    ],
    [
      ["--source", SOURCE_FIXTURE, "--skip-spoolease", "--spool-weight", "Sunlu=165"],
      "--spool-weight only applies when SpoolEase spools are created",
    ],
    [["frobnicate"], "unknown command 'frobnicate'"],
  ])("exits 2 with usage for invalid arguments %j", async (argv, message) => {
    const { code, stdout, stderr } = await run(argv);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain(`bambu-hando: error: ${message}`);
    expect(stderr).toContain("Usage:");
  });

  it("exits 1 with a message when the source cannot be loaded", async () => {
    const { code, stderr } = await run([
      "--source",
      join(home, "missing.json"),
      "--skip-spoolease",
    ]);

    expect(code).toBe(1);
    expect(stderr).toMatch(/^bambu-hando: error: ENOENT/);
  });

  it("prints usage with --help", async () => {
    const { code, stdout } = await run(["--help"]);

    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("bambu-hando tui");
  });

  it("says in every help where a remembered console and key come from", async () => {
    for (const argv of [["--help"], ["tui", "--help"], ["labels", "--help"], ["check", "--help"]]) {
      const { stdout } = await run(argv);
      expect(stdout).toContain("bambu-hando key set spoolease");
      expect(stdout).toContain("Settings");
    }
  });

  it("refuses to start the TUI without an interactive terminal", async () => {
    const { code, stderr } = await run(["tui"]);

    expect(code).toBe(2);
    expect(stderr).toContain("bambu-hando tui needs an interactive terminal");
  });
});

describe("cli labels", () => {
  let server: SpoolEaseServer;
  let home: string;
  let lpLog: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("SPOOLEASE_HOST", undefined);
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", undefined);
    server = await startSpoolEaseServer();
    server.customFilaments = "P4840583,Sunlu PETG 2.0 Vivid Yellow,230,250,PETG";
    server.spools.push(
      {
        id: "1",
        material_type: "PETG",
        color_name: "2.0 Vivid Yellow",
        color_code: "F1C400FF",
        brand: "Sunlu",
        weight_advertised: "1000",
        weight_core: "189",
        slicer_filament: "P4840583",
      },
      {
        id: "2",
        material_type: "PLA",
        color_name: "Black",
        color_code: "000000FF",
        brand: "Polymaker",
        weight_advertised: "1000",
      },
    );

    lpLog = await installFakeLp(home);
  });

  afterEach(async () => {
    await server.close();
  });

  const spooleaseArgs = (): string[] => [
    "--spoolease-host",
    "127.0.0.1",
    "--spoolease-port",
    String(server.port),
    "--spoolease-security-key",
    TEST_SECURITY_KEY,
  ];

  it("writes one label per chosen spool, in the order asked for", async () => {
    const output = join(home, "labels.pdf");
    const { code, stdout, stderr } = await run([
      "labels",
      "--spool-id",
      "2",
      "--spool-id",
      "1",
      "--output",
      output,
      ...spooleaseArgs(),
    ]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toBe(
      `Spool #2: Polymaker PLA Black\nSpool #1: Sunlu PETG 2.0 Vivid Yellow\nWrote 2 labels to ${output}\n`,
    );
    const pages = readPdf(await readFile(output));
    // The default is the common 57x32 mm thermal label.
    expect(pages.map((p) => [p.width.toFixed(2), p.height.toFixed(2)])).toEqual([
      ["161.57", "90.71"],
      ["161.57", "90.71"],
    ]);
    expect(decodeQr(pages[1]!)).toBe(
      "https://tag.spoolease.io/S1/?ID=1&M=PETG&CC=F1C400FF&CN=2%2E0%20Vivid%20Yellow&B=Sunlu&WL=1000&WE=189&SC=P4840583",
    );
    expect(pages[1]!.texts.map((t) => t.text)).toEqual([
      "Sunlu",
      "PETG",
      "2.0 Vivid Yellow",
      "230–250°C",
      "1000 g",
      "Spool #1",
    ]);
  });

  it("prints only the chosen fields, at the chosen size", async () => {
    const output = join(home, "labels.pdf");
    const { code } = await run([
      "labels",
      "--brand",
      "sunlu",
      "--fields",
      "id,brand",
      "--size",
      "40x30mm",
      "--output",
      output,
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(0);
    const [page] = readPdf(await readFile(output));
    expect(page!.texts.map((t) => t.text)).toEqual(["Sunlu", "Spool #1"]);
    expect(page!.rects).toEqual([]);
    expect(page!.width).toBeCloseTo(113.39, 2);
  });

  it("sends the labels to a printer through lp, sized to the label, and cleans up", async () => {
    const { code, stdout } = await run([
      "labels",
      "--all",
      "--printer",
      "Label-Printer",
      "--print-option",
      "Darkness=14",
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Sent 2 labels to Label-Printer: request id is Label-7 (1 file(s))\n");
    const args = (await readFile(join(lpLog, "args"), "utf-8")).trim().split("\n");
    expect(args.slice(0, -1)).toEqual([
      "-d",
      "Label-Printer",
      "-t",
      "bambu-hando labels",
      "-o",
      "media=Custom.57x32mm",
      "-o",
      "Darkness=14",
      "--",
    ]);
    expect(readPdf(await readFile(join(lpLog, "printed.pdf")))).toHaveLength(2);
    await expect(readFile(args.at(-1)!)).rejects.toThrow("ENOENT");
  });

  it("exits 1 when lp fails, keeping the written PDF", async () => {
    vi.stubEnv("LP_FAIL", "The printer or class does not exist.");
    const output = join(home, "labels.pdf");
    const { code, stderr } = await run([
      "labels",
      "--all",
      "--output",
      output,
      "--printer",
      "Nope",
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain(
      "bambu-hando: error: printing to Nope failed: lp: The printer or class does not exist.",
    );
    expect(readPdf(await readFile(output))).toHaveLength(2);
  });

  it("exits 2 when no spool matches", async () => {
    const { code, stderr } = await run([
      "labels",
      "--match",
      "galaxy",
      "--output",
      join(home, "x.pdf"),
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(2);
    expect(stderr).toBe("bambu-hando: error: no SpoolEase spools match the filters\n");
  });

  it("exits 2 for spool IDs SpoolEase doesn't have", async () => {
    const { code, stderr } = await run([
      "labels",
      "--spool-id",
      "1",
      "--spool-id",
      "7",
      "--output",
      join(home, "x.pdf"),
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(2);
    expect(stderr).toBe("bambu-hando: error: SpoolEase has no spool with ID 7\n");
  });

  it("exits 2 when SpoolEase rejects the key, before reading any spool", async () => {
    const args = [
      "labels",
      "--all",
      "--output",
      join(home, "x.pdf"),
      ...spooleaseArgs().slice(0, -1),
      "WRONG",
    ];
    const { code, stderr } = await run(args);

    expect(code).toBe(2);
    expect(stderr).toBe("SpoolEase key validation failed\n");
    // The server only records requests it can decrypt, so the rejected key check isn't listed either.
    expect(server.requests).toEqual([]);
  });

  it.each([
    [["--output", "x.pdf"], "labels needs --spool-id, --brand, --material, --match or --all"],
    [["--all"], "labels needs --output, --printer or both"],
    [
      ["--all", "--output", "x.pdf", "--size", "big"],
      'label size must look like 2.5x1.5in or 40x30mm, got "big"',
    ],
    [["--all", "--output", "x.pdf", "--fields", "brand,price"], 'unknown label field "price"'],
    [
      ["--all", "--output", "x.pdf", "--print-option", "Darkness=14"],
      "--print-option only applies with --printer",
    ],
    [["--all", "--output", "x.pdf", "--source", "spoolmandb"], "Unknown option '--source'"],
  ])("rejects labels %j", async (argv, message) => {
    const { code, stderr } = await run(["labels", ...argv, ...spooleaseArgs()]);

    expect(code).toBe(2);
    expect(stderr).toContain(`bambu-hando: error: ${message}`);
    expect(stderr).toContain("bambu-hando labels");
  });

  it("lists the label fields in its help", async () => {
    const { code, stdout } = await run(["labels", "--help"]);

    expect(code).toBe(0);
    expect(stdout).toContain("bambu-hando labels");
    expect(stdout).toContain("temps     Nozzle temperature range");
  });
});

describe("cli sync labels", () => {
  let server: SpoolEaseServer;
  let home: string;
  let lpLog: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("SPOOLEASE_HOST", undefined);
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", undefined);
    await installBambuStudio(home, { presetFolder: "1234567890" });
    server = await startSpoolEaseServer();
    // PETG Red has a spool from an earlier run; the other two get new ones.
    server.spools.push({ id: "1", slicer_filament: "PABC1234", brand: "Polymaker" });
    lpLog = await installFakeLp(home);
  });

  afterEach(async () => {
    await server.close();
  });

  const syncArgs = (): string[] => [
    "--source",
    SOURCE_FIXTURE,
    "--spoolease-host",
    "127.0.0.1",
    "--spoolease-port",
    String(server.port),
    "--spoolease-security-key",
    TEST_SECURITY_KEY,
  ];

  it("writes labels for the spools this run created, and reports them", async () => {
    const output = join(home, "new.pdf");
    const { code, stdout, stderr } = await run([...syncArgs(), "--label-output", output]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.labels).toEqual({
      status: "written",
      spool_ids: ["2", "3"],
      output,
      printer: null,
      detail: "",
    });
    const pages = readPdf(await readFile(output));
    expect(pages.map((p) => new URL(decodeQr(p)!).searchParams.get("ID"))).toEqual(["2", "3"]);
    expect(pages[0]!.texts.at(-1)!.text).toBe("Spool #2");
  });

  it("prints them with the chosen fields and size", async () => {
    const { code, stdout } = await run([
      ...syncArgs(),
      "--label-printer",
      "Label-Printer/spools",
      "--label-fields",
      "brand,id",
      "--label-size",
      "40x30mm",
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).labels).toEqual({
      status: "written",
      spool_ids: ["2", "3"],
      output: null,
      printer: "Label-Printer/spools",
      detail: "request id is Label-7 (1 file(s))",
    });
    const args = (await readFile(join(lpLog, "args"), "utf-8")).trim().split("\n");
    expect(args).toContain("media=Custom.40x30mm");
    const pages = readPdf(await readFile(join(lpLog, "printed.pdf")));
    expect(pages[1]!.texts.map((t) => t.text)).toEqual(["Generic", "Spool #3"]);
  });

  it("exits 1 when the labels can't be printed, after syncing everything", async () => {
    vi.stubEnv("LP_FAIL", "The printer or class does not exist.");
    const { code, stdout, stderr } = await run([...syncArgs(), "--label-printer", "Nope"]);

    expect(code).toBe(1);
    expect(JSON.parse(stdout).labels).toMatchObject({
      status: "failed",
      detail: "printing to Nope failed: lp: The printer or class does not exist.",
    });
    expect(stderr).toContain("bambu-hando: error: printing to Nope failed");
    expect(server.spools).toHaveLength(3);
  });

  it("makes no labels when the run created no spools", async () => {
    server.spools.push(
      { id: "2", slicer_filament: "Pb1a2a16" },
      { id: "3", slicer_filament: "Pd73077d" },
    );
    const output = join(home, "none.pdf");
    const { code, stdout } = await run([...syncArgs(), "--label-output", output]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).labels).toEqual({
      status: "skipped",
      spool_ids: [],
      output,
      printer: null,
      detail: "no new spools",
    });
    await expect(readFile(output)).rejects.toThrow("ENOENT");
  });

  it("only plans labels in a dry run", async () => {
    const output = join(home, "dry.pdf");
    const { code, stdout } = await run([...syncArgs(), "--dry-run", "--label-output", output]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).labels).toEqual({
      status: "planned",
      spool_ids: [],
      output,
      printer: null,
      detail: "dry-run",
    });
    await expect(readFile(output)).rejects.toThrow("ENOENT");
  });

  it.each([
    [
      ["--skip-spools", "--label-output", "x.pdf"],
      "--label-output and --label-printer only apply when SpoolEase spools are created",
    ],
    [
      ["--label-fields", "brand"],
      "--label-fields and --label-size need --label-output or --label-printer",
    ],
    [
      ["--label-output", "x.pdf", "--label-size", "big"],
      'label size must look like 2.5x1.5in or 40x30mm, got "big"',
    ],
    [["--label-output", "x.pdf", "--label-fields", "price"], 'unknown label field "price"'],
  ])("rejects sync labels %j", async (argv, message) => {
    const { code, stderr } = await run([...syncArgs(), ...argv]);

    expect(code).toBe(2);
    expect(stderr).toContain(`bambu-hando: error: ${message}`);
  });
});

describe("cli check", () => {
  let server: SpoolEaseServer;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    await installBambuStudio(home, { presetFolder: "1234567890" });
    vi.stubEnv("SPOOLEASE_HOST", undefined);
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", undefined);
    server = await startSpoolEaseServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const spooleaseArgs = (key = TEST_SECURITY_KEY): string[] => [
    "--spoolease-host",
    "127.0.0.1",
    "--spoolease-port",
    String(server.port),
    "--spoolease-security-key",
    key,
  ];

  // A sync leaves presets, custom filaments and spools that line up.
  async function synced(): Promise<void> {
    const { code } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);
    expect(code).toBe(0);
  }

  it("reports that everything lines up after a sync, reads only, and exits 0", async () => {
    await synced();
    const before = server.requests.length;

    const { code, stdout } = await run(["check", ...spooleaseArgs()]);

    expect(code).toBe(0);
    expect(stdout).toContain("Sync check: BambuStudio 1234567890 · SpoolEase 127.0.0.1:");
    expect(stdout).toContain("Everything lines up");
    expect(stdout).toContain("✓ SpoolEase filaments without a BambuStudio preset: none");
    // The key check is a POST that changes nothing; everything else is read.
    expect(
      server.requests
        .slice(before)
        .filter((r) => r.method !== "GET")
        .map((r) => r.path),
    ).toEqual(["/api/test-key"]);
  });

  it("lists problems and exits 1", async () => {
    await synced();
    server.spools.push({
      id: "9",
      brand: "Acme",
      material_type: "PLA",
      color_name: "Red",
      slicer_filament: "PZZZZZZZ",
    });

    const { code, stdout } = await run(["check", ...spooleaseArgs()]);

    expect(code).toBe(1);
    expect(stdout).toContain("1 problem, 0 notes");
    expect(stdout).toContain("✗ Spools whose filament SpoolEase doesn't list: 1");
    expect(stdout).toContain("    #9 Acme PLA Red (PZZZZZZZ)");
  });

  it("exits 0 when there are only notes", async () => {
    server.spools.push({ id: "1", brand: "Acme", material_type: "PLA", color_name: "Red" });

    const { code, stdout } = await run(["check", ...spooleaseArgs()]);

    expect(code).toBe(0);
    expect(stdout).toContain("0 problems, 1 note");
  });

  it("prints a snake_case JSON report with --json", async () => {
    await synced();
    server.spools.push({
      id: "9",
      brand: "Acme",
      material_type: "PLA",
      color_name: "Red",
      slicer_filament: "PZZZZZZZ",
    });

    const { code, stdout } = await run([
      "check",
      "--json",
      "--preset-folder",
      "1234567890",
      ...spooleaseArgs(),
    ]);

    expect(code).toBe(1);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({
      preset_folder: "1234567890",
      summary: { problems: 1, notes: 0 },
      warnings: [],
    });
    expect(report.spoolease).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(report.sections.find((s: { key: string }) => s.key === "unknown_code")).toEqual({
      key: "unknown_code",
      title: "Spools whose filament SpoolEase doesn't list",
      problem: true,
      items: ["#9 Acme PLA Red (PZZZZZZZ)"],
    });
  });

  it("exits 2 on a rejected key", async () => {
    const { code, stderr } = await run(["check", ...spooleaseArgs("WRONG")]);
    expect(code).toBe(2);
    expect(stderr).toContain("SpoolEase key validation failed");
  });

  it("exits 2 with usage for an unknown flag, and shows help", async () => {
    const bad = await run(["check", "--nope"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("bambu-hando check");

    const help = await run(["check", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("bambu-hando check");
  });
});
