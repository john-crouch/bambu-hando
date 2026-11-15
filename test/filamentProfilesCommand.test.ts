// ABOUTME: Integration tests for `bambu-hando 3dfp usage|spools` against a local 3DFilamentProfiles stand-in.
// ABOUTME: The key comes from FILAMENTPROFILES_API_KEY, so no keyring is involved; HOME is a temp dir.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { type FilamentProfilesServer, serverSpool, startFilamentProfilesServer, TEST_API_KEY } from "./filamentProfilesServer.js";

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
      serverSpool({ short_code: "XYZ789", brand: "OVERTURE", material: "PLA", material_type: "Matte", color: "Black", remaining_grams: 0, location: "Empty" }),
    ];
    const home = await mkdtemp(join(tmpdir(), "bh-3dfp-cmd-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
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
      expect(stdout).toContain("Usage: bambu-hando 3dfp <usage|spools> [options]");
    }
  });

  it("rejects an unknown action or option", async () => {
    expect(await run(["3dfp", "sync"])).toMatchObject({ code: 2 });
    expect((await run(["3dfp", "spools", "--fast"])).code).toBe(2);
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
    expect(second.stdout).toContain("2 spools from the cache, fetched 2026-11-15 13:00 UTC (no API call; --refresh fetches again)");
    expect(server.requests).toHaveLength(1);

    await run(["3dfp", "spools", "--refresh"]);
    expect(server.requests).toHaveLength(2);
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
    expect(report.spools[0]).toMatchObject({ short_code: "ABC123", filament_id: 101, remaining_grams: 740, empty_spool_weight: 189, location: "Shelf A" });
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

  it("exits 2 when the key is rejected or the quota is used up", async () => {
    vi.stubEnv("FILAMENTPROFILES_API_KEY", "3dfp_wrong");
    expect(await run(["3dfp", "spools"])).toMatchObject({ code: 2, stderr: expect.stringContaining("bambu-hando key set 3dfp") });

    vi.stubEnv("FILAMENTPROFILES_API_KEY", TEST_API_KEY);
    server.quota.remaining = 0;
    expect(await run(["3dfp", "spools"])).toMatchObject({ code: 2, stderr: expect.stringContaining("used up until 2026-12-01 00:00 UTC") });
  });

  it("exits 1 when the API fails", async () => {
    server.replies["/api/v1/my/spools"] = { status: 500, body: { error: { code: "internal", message: "An unexpected error occurred" } } };
    expect(await run(["3dfp", "spools"])).toMatchObject({ code: 1, stderr: expect.stringContaining("An unexpected error occurred (internal)") });
  });
});
