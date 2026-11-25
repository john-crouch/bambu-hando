// ABOUTME: Tests for `bambu-hando 3dfp import`: the plan it shows, asking first, a full import against the stand-ins,
// ABOUTME: and the sync that follows keeping the new link (by the link file and by the SpoolEase ID on 3DFP).

import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { configDir } from "../src/paths.js";
import { baseFilamentDir, installBambuStudio, X1C_04 } from "./bambuStudioSetup.js";
import {
  type FilamentProfilesServer,
  serverFilament,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";

describe("bambu-hando 3dfp import", () => {
  let tdfp: FilamentProfilesServer;
  let spoolease: SpoolEaseServer;
  let home: string;
  let answer: boolean | null;

  beforeEach(async () => {
    tdfp = await startFilamentProfilesServer();
    tdfp.quota.remaining = 900;
    tdfp.filaments = [
      serverFilament({ id: 10512, material_type: "Elite", color: "Mildewed Red", rgb: "#AD0000" }),
    ];
    tdfp.spools = [
      serverSpool({
        short_code: "izDGMo7fU",
        filament_id: 10512,
        brand: "SUNLU",
        material_type: "Elite",
        color: "Mildewed Red",
        rgb: "#AD0000",
        empty_spool_weight: 180,
      }),
    ];
    spoolease = await startSpoolEaseServer();
    home = await mkdtemp(join(tmpdir(), "bh-3dfp-import-"));
    await installBambuStudio(home);
    answer = null;
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("XDG_DATA_HOME", undefined);
    vi.stubEnv("FILAMENTPROFILES_API_KEY", TEST_API_KEY);
    vi.stubEnv("FILAMENTPROFILES_API_URL", tdfp.url);
    vi.stubEnv("SPOOLEASE_HOST", "127.0.0.1");
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", TEST_SECURITY_KEY);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await tdfp.close();
    await spoolease.close();
  });

  async function run(
    command: "import" | "sync",
    ...args: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    const code = await main(
      ["3dfp", command, "--spoolease-port", String(spoolease.port), ...args],
      {
        stdout: (s: string) => (stdout += s),
        stderr: (s: string) => (stderr += s),
        confirm: async () => answer,
      },
    );
    expect(stdout + stderr).not.toContain(TEST_API_KEY);
    expect(stdout + stderr).not.toContain(TEST_SECURITY_KEY);
    return { code, stdout, stderr };
  }

  const linkFile = () => join(configDir(process.platform, home, {}), "3dfp-links.json");

  it("shows what it would write on a dry run, with where the print settings come from", async () => {
    const { code, stdout, stderr } = await run(
      "import",
      "izDGMo7fU",
      "NOPE",
      "--printer-preset",
      X1C_04,
      "--dry-run",
    );
    expect({ code, stderr }).toEqual({ code: 1, stderr: "" });
    expect(stdout).toContain(
      "Import    izDGMo7fU SUNLU PETG Elite Mildewed Red: presets, SpoolEase filament Pf06dde9 and a spool",
    );
    expect(stdout).toContain(
      "          print 240°C · bed 75°C · flow 0.95 · max 16 mm³/s (3DFP's record)",
    );
    expect(stdout).toContain("Skip      NOPE: 3DFilamentProfiles has no spool NOPE");
    expect(stdout).toContain("Dry run: nothing changed.");
    expect(spoolease.spools).toHaveLength(0);
    await expect(readdir(baseFilamentDir(home))).rejects.toThrow();
  });

  it("asks first, and changes nothing without a yes", async () => {
    answer = false;
    const { code, stdout } = await run("import", "izDGMo7fU", "--printer-preset", X1C_04);
    expect(code).toBe(0);
    expect(stdout).toContain("Nothing changed.");
    expect(spoolease.spools).toHaveLength(0);
  });

  it("imports: presets, the CSV row, a spool, the link and its SpoolEase ID; the next sync keeps it", async () => {
    const { code, stdout } = await run("import", "izDGMo7fU", "--printer-preset", X1C_04, "--yes");
    expect(code).toBe(0);
    expect(stdout).toContain("Imported  izDGMo7fU → SpoolEase spool #1");
    expect(await readdir(baseFilamentDir(home))).toEqual([
      `SUNLU PETG Elite Mildewed Red @${X1C_04}.json`,
    ]);
    expect(spoolease.customFilaments).toContain("Pf06dde9");
    expect(spoolease.spools).toHaveLength(1);
    expect(tdfp.spools[0]?.external_id).toBe("spoolease:1");
    expect(JSON.parse(await readFile(linkFile(), "utf-8")).books[0].links).toMatchObject([
      { spoolease: "1", tdfp: "izDGMo7fU", agreed: null, tag: null },
    ]);

    const again = await run("import", "izDGMo7fU", "--printer-preset", X1C_04, "--yes");
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("Skip      izDGMo7fU: already linked to SpoolEase spool #1");

    const sync = await run("sync", "--dry-run");
    expect(sync.stdout).not.toContain("3DFP only");
    expect(sync.stdout).toContain("#1 SUNLU PETG Elite Mildewed Red ↔ izDGMo7fU");
  });

  it("refuses without short codes, or with something that isn't one", async () => {
    expect((await run("import")).code).toBe(2);
    const odd = await run("import", "a b");
    expect(odd.code).toBe(2);
    expect(odd.stderr).toContain("a 3DFP short code is letters and digits");
  });
});
