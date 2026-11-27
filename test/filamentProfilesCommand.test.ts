// ABOUTME: Integration tests for `bambu-hando 3dfp usage|spools` against a local 3DFilamentProfiles stand-in.
// ABOUTME: The key comes from FILAMENTPROFILES_API_KEY, so no keyring is involved; HOME is a temp dir.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { FILAMENT_DB_FIXTURE } from "./filamentDbFixture.js";
import {
  type FilamentProfilesServer,
  serverFilament,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";

async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  expect(stdout + stderr).not.toContain(TEST_API_KEY);
  return { code, stdout, stderr };
}

describe("bambu-hando 3dfp", () => {
  let server: FilamentProfilesServer;

  beforeEach(async () => {
    server = await startFilamentProfilesServer();
    server.quota.remaining = 983;
    server.spools = [
      serverSpool(),
      serverSpool({
        short_code: "XYZ789",
        brand: "OVERTURE",
        material: "PLA",
        material_type: "Matte",
        color: "Black",
        remaining_grams: 0,
        location: "Empty",
      }),
    ];
    const home = await mkdtemp(join(tmpdir(), "bh-3dfp-cmd-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("XDG_DATA_HOME", undefined);
    vi.stubEnv("FILAMENTPROFILES_API_KEY", TEST_API_KEY);
    vi.stubEnv("FILAMENTPROFILES_API_URL", server.url);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T13:00:00Z") });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await server.close();
  });

  it("prints usage", async () => {
    for (const argv of [["3dfp"], ["3dfp", "--help"]]) {
      const { code, stdout } = await run(argv);
      expect(code).toBe(0);
      expect(stdout).toContain(
        "Usage: bambu-hando 3dfp <usage|spools|sync|import|filament|search|fill|catalog> [options]",
      );
    }
  });

  it("rejects an unknown action or option", async () => {
    const unknown = await run(["3dfp", "frobnicate"]);
    expect(unknown).toMatchObject({
      code: 2,
      stderr: expect.stringContaining(
        "unknown action (usage, spools, sync, filament, search, fill or catalog)",
      ),
    });
    expect(unknown.stderr).not.toContain("frobnicate");
    expect((await run(["3dfp", "spools", "--fast"])).code).toBe(2);
  });

  it("refuses a key typed as an argument, without repeating it", async () => {
    for (const argv of [
      ["3dfp", "3dfp_LEAKME"],
      ["3dfp", "search", "3dfp_LEAKME"],
      ["3dfp", "spools", "--3dfp_LEAKME"],
      ["3dfp", "spools", "--brand=3dfp_LEAKME"],
    ]) {
      const { code, stderr } = await run(argv);
      expect(code).toBe(2);
      expect(stderr).toContain("shell history");
      expect(stderr).not.toContain("LEAKME");
    }
    expect(server.requests).toHaveLength(0);
  });

  it("lists the account's spools with one call, then from the cache", async () => {
    const first = await run(["3dfp", "spools"]);
    expect(first).toMatchObject({ code: 0, stderr: "" });
    expect(first.stdout).toBe(
      [
        "ABC123  Sunlu PETG Vivid Yellow   740 g  Shelf A",
        "XYZ789  OVERTURE PLA Matte Black    0 g  Empty",
        "2 spools from 3DFilamentProfiles (1 API call; 982 of 1000 left this month)",
        "",
      ].join("\n"),
    );

    vi.setSystemTime(new Date("2026-11-15T13:20:00Z"));
    const second = await run(["3dfp", "spools"]);
    expect(second.stdout).toContain(
      "2 spools from the cache, fetched 2026-11-15 13:00 UTC (no API call; --refresh fetches again)",
    );
    expect(server.requests).toHaveLength(1);

    await run(["3dfp", "spools", "--refresh"]);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.query).toEqual({});

    vi.setSystemTime(new Date("2026-11-15T14:30:00Z"));
    const third = await run(["3dfp", "spools"]);
    expect(server.requests[2]?.query).toEqual({ updated_since: "2026-11-15T13:20:00.000Z" });
    expect(third.stdout).toContain(
      "2 spools from 3DFilamentProfiles, with what changed since the last list (1 API call; ",
    );
  });

  it("never lets a spool's name drive the terminal, in text or JSON", async () => {
    server.spools = [serverSpool({ color: "Red\u001b[2J\u001b]0;pwned\u0007\u202e" })];
    const text = await run(["3dfp", "spools", "--refresh"]);
    expect(text.stdout).toContain("Red\\u001b[2J\\u001b]0;pwned\\u0007\\u202e");
    for (const char of ["\u001b", "\u0007", "\u202e"]) expect(text.stdout).not.toContain(char);
    const json = await run(["3dfp", "spools", "--json", "--refresh"]);
    for (const char of ["\u001b", "\u0007", "\u202e"]) expect(json.stdout).not.toContain(char);
    expect(JSON.parse(json.stdout).spools[0].color).toBe("Red\u001b[2J\u001b]0;pwned\u0007\u202e");
  });

  it("prints the spools as snake_case JSON", async () => {
    const { code, stdout } = await run(["3dfp", "spools", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({
      fetched_at: "2026-11-15T13:00:00.000Z",
      from_cache: false,
      quota: { limit: 1000, remaining: 982, exact: true, resets_at: "2026-12-01T00:00:00.000Z" },
    });
    expect(report.spools[0]).toMatchObject({
      short_code: "ABC123",
      filament_id: 101,
      remaining_grams: 740,
      empty_spool_weight: 189,
      location: "Shelf A",
    });
  });

  it("reports the quota without a call", async () => {
    expect((await run(["3dfp", "usage"])).stdout).toBe(
      "3DFilamentProfiles API: calls left this month unknown until the first call; the quota resets 2026-12-01 00:00 UTC.\n",
    );
    await run(["3dfp", "spools"]);
    expect((await run(["3dfp", "usage"])).stdout).toBe(
      "3DFilamentProfiles API: 982 of 1000 calls left this month (as of 2026-11-15 13:00 UTC); the quota resets 2026-12-01 00:00 UTC.\n",
    );
    vi.setSystemTime(new Date("2026-12-02T08:00:00Z"));
    expect((await run(["3dfp", "usage"])).stdout).toBe(
      "3DFilamentProfiles API: about 1000 of 1000 calls left this month (estimated); the quota resets 2027-01-01 00:00 UTC.\n",
    );
    expect(server.requests).toHaveLength(1);
  });

  it("needs a key", async () => {
    vi.stubEnv("FILAMENTPROFILES_API_KEY", undefined);
    vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent/bus");
    const { code, stderr } = await run(["3dfp", "spools"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/bambu-hando key set 3dfp|FILAMENTPROFILES_API_KEY/);
    expect(server.requests).toHaveLength(0);
  });

  it("exits 2 on a mangled key, without sending it or printing it", async () => {
    vi.stubEnv("FILAMENTPROFILES_API_KEY", "3dfp_LEAK ME");
    const { code, stderr } = await run(["3dfp", "spools"]);
    expect(code).toBe(2);
    expect(stderr).toContain(
      "FILAMENTPROFILES_API_KEY doesn't hold a usable 3DFilamentProfiles API key",
    );
    expect(stderr).not.toContain("LEAK");
    expect(server.requests).toHaveLength(0);
  });

  it("exits 2 when the key is rejected or the quota is used up", async () => {
    vi.stubEnv("FILAMENTPROFILES_API_KEY", "3dfp_wrong");
    expect(await run(["3dfp", "spools"])).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("bambu-hando key set 3dfp"),
    });

    vi.stubEnv("FILAMENTPROFILES_API_KEY", TEST_API_KEY);
    server.quota.remaining = 0;
    expect(await run(["3dfp", "spools"])).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("used up until 2026-12-01 00:00 UTC"),
    });
  });

  it("exits 1 when the API fails", async () => {
    server.replies["/api/v1/my/spools"] = {
      status: 500,
      body: { error: { code: "internal", message: "An unexpected error occurred" } },
    };
    expect(await run(["3dfp", "spools"])).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("An unexpected error occurred (internal)"),
    });
  });

  describe("the local catalog", () => {
    beforeEach(() => {
      server.filaments = [
        serverFilament(),
        serverFilament({ id: 102, color: "Black", discontinued: true }),
        serverFilament({
          id: 103,
          brand_key: "esun",
          brand_name: "eSUN",
          material_key: "pla",
          material: "PLA",
          material_type: "Matte",
          color: "Light Khaki",
        }),
      ];
    });

    it("shows a filament's full record, fetching it once", async () => {
      const first = await run(["3dfp", "filament", "101"]);
      expect(first).toMatchObject({ code: 0, stderr: "" });
      expect(first.stdout).toBe(
        [
          "Sunlu PETG Vivid Yellow (3DFilamentProfiles #101)",
          "  Nozzle 230-250 °C · bed 70-80 °C",
          "  Density 1.27 g/cm³ · diameter 1.75 mm · 1000 g on a 189 g spool",
          "  Flow ratio 0.95 · K 0.04 · max volumetric speed 16 mm³/s",
          "  Drying 65 °C for 6 h · softens at 78 °C",
          "  https://3dfilamentprofiles.com/filament/details/101",
          "Fetched just now (1 API call; 982 of 1000 left this month).",
          "",
        ].join("\n"),
      );
      const second = await run(["3dfp", "filament", "101"]);
      expect(second.stdout).toContain("From the catalog, fetched 2026-11-15 (no API call).");
      expect(server.requests).toHaveLength(1);
    });

    it("uses a 30-day-old record unless --refresh-stale is given", async () => {
      await run(["3dfp", "filament", "101"]);
      server.filaments[0] = serverFilament({ flow_ratio: 0.9 });
      vi.setSystemTime(new Date("2026-12-20T10:00:00Z"));
      const kept = await run(["3dfp", "filament", "101"]);
      expect(kept.stdout).toContain("Flow ratio 0.95");
      expect(kept.stdout).toContain(
        "From the catalog, fetched 2026-11-15 (34 days old; --refresh-stale fetches it again: 1 API call).",
      );
      expect(server.requests).toHaveLength(1);

      const refreshed = await run(["3dfp", "filament", "101", "--refresh-stale"]);
      expect(refreshed.stdout).toContain("Flow ratio 0.9 ");
      expect(server.requests).toHaveLength(2);
    });

    it("shows a record from filament-db's export without a key or a call", async () => {
      vi.stubEnv("FILAMENT_DB_EXPORT", FILAMENT_DB_FIXTURE);
      vi.stubEnv("FILAMENTPROFILES_API_KEY", undefined);
      vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent/bus");
      vi.setSystemTime(new Date("2026-11-28T10:00:00Z"));
      const shown = await run(["3dfp", "filament", "32336"]);
      expect(shown).toMatchObject({ code: 0, stderr: "" });
      expect(shown.stdout).toContain(
        "Creality PETG Basic Transparent Wine Red (3DFilamentProfiles #32336)",
      );
      expect(shown.stdout).toContain(
        "From filament-db's export, fetched 2026-11-27 (no API call).",
      );
      expect(server.requests).toHaveLength(0);
    });

    it("prints a record as snake_case JSON", async () => {
      const report = JSON.parse((await run(["3dfp", "filament", "101", "--json"])).stdout);
      expect(report).toMatchObject({
        fetched: true,
        stale: false,
        age_days: 0,
        record_at: "2026-11-15T13:00:00.000Z",
      });
      expect(report.filament).toMatchObject({
        id: 101,
        brand_key: "sunlu",
        temp_min: 230,
        flow_ratio: 0.95,
        k_value: 0.04,
      });
    });

    it("rejects an id that isn't a whole number without a call", async () => {
      expect((await run(["3dfp", "filament", "abc"])).code).toBe(2);
      expect((await run(["3dfp", "filament"])).code).toBe(2);
      expect(server.requests).toHaveLength(0);
    });

    it("searches the catalog locally, or online with --online", async () => {
      const empty = await run(["3dfp", "search", "sunlu"]);
      expect(empty.stdout).toBe(
        "No matches in the catalog (no API call; --online searches 3DFilamentProfiles: 1 call).\n",
      );

      const online = await run(["3dfp", "search", "--online", "--brand", "sunlu"]);
      expect(online.stdout).toBe(
        [
          "#101  Sunlu PETG Vivid Yellow",
          "#102  Sunlu PETG Black (discontinued)",
          "2 of 2 matches from 3DFilamentProfiles (1 API call; 982 of 1000 left this month).",
          "",
        ].join("\n"),
      );

      const local = await run(["3dfp", "search", "black"]);
      expect(local.stdout).toBe(
        ["#102  Sunlu PETG Black (discontinued)", "1 match in the catalog (no API call).", ""].join(
          "\n",
        ),
      );
      expect(server.requests).toHaveLength(1);
    });

    it("reads the catalog without a key when no call is needed", async () => {
      await run(["3dfp", "filament", "101"]);
      await run(["3dfp", "search", "--online", "--brand", "sunlu"]);
      vi.stubEnv("FILAMENTPROFILES_API_KEY", undefined);
      vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent/bus");

      expect(await run(["3dfp", "search", "black"])).toMatchObject({
        code: 0,
        stdout: expect.stringContaining("1 match in the catalog (no API call)."),
      });
      expect(await run(["3dfp", "filament", "101"])).toMatchObject({
        code: 0,
        stdout: expect.stringContaining("From the catalog, fetched 2026-11-15 (no API call)."),
      });
      // A record it would have to fetch still needs the key.
      const fetching = await run(["3dfp", "filament", "102"]);
      expect(fetching.code).not.toBe(0);
      expect(fetching.stderr).toMatch(/bambu-hando key set 3dfp|FILAMENTPROFILES_API_KEY/);
    });

    it("needs words or a filter to search", async () => {
      expect((await run(["3dfp", "search"])).code).toBe(2);
    });

    it("waits for the month-end fill unless --now, and keeps the reserve", async () => {
      const early = await run(["3dfp", "fill"]);
      expect(early).toMatchObject({
        code: 0,
        stdout: "Nothing to do: the month-end fill starts on 2026-11-28 (UTC); --now fills now.\n",
      });
      expect(server.requests).toHaveLength(0);

      const filled = await run(["3dfp", "fill", "--now", "--reserve", "970"]);
      expect(filled.code).toBe(0);
      expect(filled.stdout).toMatch(
        /^Filled the catalog: \d+ API calls, 1 full record; 3 filaments from 2 brands\. Stopped: .*kept in reserve\n$/,
      );
      expect(server.requests[0]?.path).toBe("/api/v1/my/spools");
      expect(server.requests[1]?.path).toBe("/api/v1/filaments/101");
      expect(server.quota.remaining).toBe(970);
    });

    it("doesn't spend the reserve on the spool list either", async () => {
      await run(["3dfp", "filament", "101"]);
      const left = server.quota.remaining;
      const before = server.requests.length;
      const filled = await run(["3dfp", "fill", "--now", "--reserve", String(left)]);
      expect(filled.code).toBe(0);
      expect(filled.stdout).toMatch(/^Filled the catalog: 0 API calls, /);
      expect(server.requests.slice(before).map((r) => r.path)).toEqual([]);
      expect(server.quota.remaining).toBe(left);
    });

    it("reports what the catalog holds without a call", async () => {
      await run(["3dfp", "filament", "101"]);
      const { stdout } = await run(["3dfp", "catalog"]);
      expect(stdout).toBe(
        "3DFilamentProfiles catalog: 1 filament (1 full record) from 1 brand, 0 brands filled; ~/.local/share/bambu-hando/3dfp-catalog.sqlite\n",
      );
      expect(server.requests).toHaveLength(1);
    });
  });
});
