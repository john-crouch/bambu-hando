// ABOUTME: Integration tests for `bambu-hando 3dfp sync` against local SpoolEase and 3DFilamentProfiles stand-ins.
// ABOUTME: Checks the plan it prints, that it asks before writing, what it sends, and the link file it keeps.

import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { configDir } from "../src/paths.js";
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

/** Sunlu PETG 2.0 Vivid Yellow on a 189 g core, weighing 753 g: 564 g left. */
function seSpool(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    id: "1",
    tag_id: "04A1B2C3D4E5F6",
    material_type: "PETG",
    material_subtype: "",
    color_name: "2.0 Vivid Yellow",
    color_code: "FFD700FF",
    brand: "Sunlu",
    weight_advertised: "1000",
    weight_core: "189",
    weight_current: "753",
    slicer_filament: "P4840583",
    ...overrides,
  };
}

describe("bambu-hando 3dfp sync", () => {
  let tdfp: FilamentProfilesServer;
  let spoolease: SpoolEaseServer;
  let home: string;
  let asked: string[];
  let answer: boolean | null;

  beforeEach(async () => {
    tdfp = await startFilamentProfilesServer();
    tdfp.quota.remaining = 900;
    tdfp.filaments = [serverFilament()];
    tdfp.spools = [serverSpool({ remaining_grams: 1000 })];
    spoolease = await startSpoolEaseServer();
    spoolease.spools = [seSpool()];
    home = await mkdtemp(join(tmpdir(), "bh-3dfp-sync-"));
    asked = [];
    answer = null;
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("XDG_DATA_HOME", undefined);
    vi.stubEnv("FILAMENTPROFILES_API_KEY", TEST_API_KEY);
    vi.stubEnv("FILAMENTPROFILES_API_URL", tdfp.url);
    vi.stubEnv("SPOOLEASE_HOST", "127.0.0.1");
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", TEST_SECURITY_KEY);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T13:00:00Z") });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await tdfp.close();
    await spoolease.close();
  });

  async function sync(
    ...args: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    const io = {
      stdout: (s: string) => (stdout += s),
      stderr: (s: string) => (stderr += s),
      confirm: async (question: string) => {
        asked.push(question);
        return answer;
      },
    };
    const code = await main(
      ["3dfp", "sync", "--spoolease-port", String(spoolease.port), ...args],
      io,
    );
    expect(stdout + stderr).not.toContain(TEST_API_KEY);
    expect(stdout + stderr).not.toContain(TEST_SECURITY_KEY);
    return { code, stdout, stderr };
  }

  const writes = () =>
    tdfp.requests.filter((r) => r.method !== "GET").map((r) => [r.method, r.path, r.body]);
  const linkFile = () => join(configDir(process.platform, home, {}), "3dfp-links.json");
  const savedLinks = async () => JSON.parse(await readFile(linkFile(), "utf-8")).books[0].links;

  it("shows the plan on a dry run and changes nothing", async () => {
    const { code, stdout, stderr } = await sync("--dry-run");
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toBe(
      [
        "Spool sync: SpoolEase 127.0.0.1 (1 spool) · 3DFilamentProfiles (1 spool, 1 API call)",
        "",
        "Link      #1 Sunlu PETG 2.0 Vivid Yellow ↔ ABC123 Sunlu PETG Vivid Yellow (same brand, material and color)",
        "          weight 1000 → 564 g, from SpoolEase; tag written to 3DFP",
        "",
        "1 change: 1 API call (899 of 1000 left this month). Dry run: nothing changed.",
        "",
      ].join("\n"),
    );
    expect(asked).toEqual([]);
    expect(writes()).toEqual([]);
    await expect(stat(linkFile())).rejects.toThrow();
  });

  it("asks before writing, and writes nothing on a no", async () => {
    answer = false;
    const { code, stdout } = await sync();
    expect(code).toBe(0);
    expect(asked).toEqual(["Apply? [y/N] "]);
    expect(stdout).toMatch(/Nothing changed\.\n$/);
    expect(writes()).toEqual([]);
  });

  it("says how to apply when it can't ask", async () => {
    const { code, stdout } = await sync();
    expect(code).toBe(0);
    expect(stdout).toMatch(/Not applied: pass --yes, or run this in a terminal to be asked\.\n$/);
    expect(writes()).toEqual([]);
  });

  it("links, pushes the weight and tag in one call, and keeps the link privately", async () => {
    answer = true;
    const { code, stdout } = await sync();
    expect(code).toBe(0);
    expect(writes()).toEqual([
      [
        "PATCH",
        "/api/v1/my/spools/ABC123",
        { remaining_grams: 564, bambu_tag_id: "04A1B2C3D4E5F6" },
      ],
    ]);
    expect(stdout).toMatch(
      /\nDone: 1 change applied \(1 API call; 898 of 1000 left this month\)\. Links: ~\/\.config\/bambu-hando\/3dfp-links\.json\n$/,
    );
    expect(await savedLinks()).toEqual([
      {
        spoolease: "1",
        tdfp: "ABC123",
        agreed: { spoolease: 564, tdfp: 564 },
        tag: "04A1B2C3D4E5F6",
        linkedAt: "2026-11-15T13:00:00.000Z",
      },
    ]);
    expect((await stat(linkFile())).mode & 0o777).toBe(0o600);

    // The write made the cached list stale, so the next run reads it again; then the pair is in step.
    asked = [];
    const again = await sync();
    expect(again.stdout).toContain("3DFilamentProfiles (1 spool, 1 API call)");
    expect(again.stdout).toContain("In step   #1 Sunlu PETG 2.0 Vivid Yellow ↔ ABC123: 564 g");
    expect(again.stdout).toMatch(/\nNothing to change\.\n$/);
    expect(asked).toEqual([]);
  });

  it("keeps an unreadable link file aside, and says where", async () => {
    await mkdir(dirname(linkFile()), { recursive: true });
    await writeFile(linkFile(), "{not json", "utf-8");
    const { code, stderr } = await sync("--yes");
    expect(code).toBe(0);
    expect(stderr).toMatch(
      /can't be read: starting with no links; it will be set aside, not overwritten\n/,
    );
    expect(stderr).toMatch(
      /The unreadable spool link file was kept as .*3dfp-links\.json\.damaged-/,
    );
    expect(await savedLinks()).toHaveLength(1);
  });

  it("applies without asking with --yes", async () => {
    expect((await sync("--yes")).code).toBe(0);
    expect(asked).toEqual([]);
    expect(writes()).toHaveLength(1);
  });

  it("takes SpoolEase's weight on a first link, even when 3DFP's is lower", async () => {
    tdfp.spools = [serverSpool({ remaining_grams: 400 })];
    const { stdout } = await sync("--yes");
    expect(stdout).toContain("          weight 400 → 564 g, from SpoolEase; tag written to 3DFP");
    expect(writes()).toEqual([
      [
        "PATCH",
        "/api/v1/my/spools/ABC123",
        { remaining_grams: 564, bambu_tag_id: "04A1B2C3D4E5F6" },
      ],
    ]);
  });

  it("asks for a weigh when only 3DFP's weight moved since they agreed", async () => {
    await sync("--yes");
    tdfp.spools = [serverSpool({ remaining_grams: 400, bambu_tag_id: "04A1B2C3D4E5F6" })];
    const before = writes().length;
    const { stdout } = await sync("--yes", "--refresh");
    expect(stdout).toContain(
      "SpoolEase 564 g, 3DFP 400 g: put it on SpoolEase's scale (only the scale sets SpoolEase's weight)",
    );
    expect(writes()).toHaveLength(before);
  });

  it("offers to add a SpoolEase spool to 3DFP once the catalog knows its filament", async () => {
    tdfp.spools = [];
    const first = await sync("--dry-run");
    expect(first.stdout).toContain(
      'Choose    #1 Sunlu PETG 2.0 Vivid Yellow: not on 3DFP, and no catalog filament fits: find it with `bambu-hando 3dfp search --online "Sunlu PETG 2.0 Vivid Yellow"`, then --add 1=<filament>',
    );

    expect(
      (await main(["3dfp", "search", "--online", "Sunlu PETG Vivid Yellow"], {
        stdout: () => {},
        stderr: () => {},
      })) as number,
    ).toBe(0);
    const { code, stdout } = await sync("--yes");
    expect(code).toBe(0);
    expect(stdout).toContain(
      "Add       #1 Sunlu PETG 2.0 Vivid Yellow to 3DFP as #101 Sunlu PETG Vivid Yellow at 564 g, with its tag",
    );
    expect(stdout).toContain("1 change: 2 API calls");
    expect(writes()).toEqual([
      ["POST", "/api/v1/my/spools", { filament_id: 101, remaining_grams: 564 }],
      ["PATCH", "/api/v1/my/spools/NEW001", { bambu_tag_id: "04A1B2C3D4E5F6" }],
    ]);
    expect(await savedLinks()).toMatchObject([
      { spoolease: "1", tdfp: "NEW001", tag: "04A1B2C3D4E5F6" },
    ]);
  });

  it("takes the user's pairing and unlinks on request", async () => {
    tdfp.spools = [
      serverSpool({ remaining_grams: 1000 }),
      serverSpool({ short_code: "DEF456", remaining_grams: 1000 }),
    ];
    const ambiguous = await sync("--dry-run");
    expect(ambiguous.stdout).toContain(
      "Choose    #1 Sunlu PETG 2.0 Vivid Yellow: several 3DFP spools fit (ABC123, DEF456): pick one with --link 1=<code>",
    );

    await sync("--yes", "--link", "1=DEF456");
    expect(await savedLinks()).toMatchObject([{ spoolease: "1", tdfp: "DEF456" }]);

    const unlinked = await sync("--yes", "--unlink", "1");
    expect(unlinked.stdout).toContain("Unlink    #1 ↔ DEF456: as asked");
    expect(await savedLinks()).toEqual([]);
  });

  it("stops before sending anything when the quota can't cover the plan", async () => {
    tdfp.quota.remaining = 1;
    const { code, stderr } = await sync("--yes");
    expect(code).toBe(2);
    expect(stderr).toBe(
      "bambu-hando: error: the monthly 3DFilamentProfiles API quota is used up until 2026-12-01 00:00 UTC\n",
    );
    expect(writes()).toEqual([]);
  });

  it("refuses choices and arguments it can't use", async () => {
    for (const args of [["--link", "1"], ["--add", "1=abc"], ["--unlink", ""], ["extra"]]) {
      const { code, stderr } = await sync("--dry-run", ...args);
      expect(code).toBe(2);
      expect(stderr).toContain("Usage: bambu-hando 3dfp sync");
    }
    expect(await sync("--dry-run", "--link", "9=ABC123")).toMatchObject({
      code: 2,
      stderr: "bambu-hando: error: SpoolEase has no spool #9\n",
    });
    expect((await sync("--dry-run", "extra")).stderr).not.toContain("extra");
  });

  it("refuses a key typed as an argument, without repeating it", async () => {
    for (const args of [["3dfp_LEAKME"], ["--3dfp_LEAKME"]]) {
      const { code, stderr } = await sync("--dry-run", ...args);
      expect(code).toBe(2);
      expect(stderr).toContain("shell history");
      expect(stderr).not.toContain("LEAKME");
    }
  });

  it("needs the SpoolEase console, and its key to work", async () => {
    vi.stubEnv("SPOOLEASE_HOST", "");
    expect((await sync("--dry-run")).stderr).toMatch(
      /SpoolEase host and security key are required/,
    );
    vi.stubEnv("SPOOLEASE_HOST", "127.0.0.1");
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", "WRONGKEY");
    expect(await sync("--dry-run")).toMatchObject({
      code: 2,
      stderr: "SpoolEase key validation failed\n",
    });
    expect(tdfp.requests).toEqual([]);
  });

  it("prints its help", async () => {
    const { code, stdout } = await sync("--help");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Usage: bambu-hando 3dfp sync \[options\]/);
  });
});
