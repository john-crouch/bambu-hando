// ABOUTME: Integration tests for sync orchestration against a local SpoolEase server.
// ABOUTME: Covers statuses, progress events, and failure handling for both integrations.

import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeyCheckError, runSync, SetupError, type SyncEvent, type SyncOptions } from "../src/sync.js";
import { baseFilamentDir, installBambuStudio, X1C_04 } from "./bambuStudioSetup.js";
import { profileAt } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

describe("runSync", () => {
  let server: SpoolEaseServer;
  let filamentDir: string;
  let events: SyncEvent[];

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    await installBambuStudio(home);
    filamentDir = baseFilamentDir(home);
    server = await startSpoolEaseServer();
    events = [];
  });

  afterEach(async () => {
    await server.close();
  });

  function options(overrides: Partial<SyncOptions> = {}): SyncOptions {
    return {
      profiles: [profileAt(0), profileAt(1)],
      presetFolder: "default",
      printers: [X1C_04],
      dryRun: false,
      spoolease: { host: "127.0.0.1", port: server.port, securityKey: TEST_SECURITY_KEY, https: false },
      createSpools: false,
      ...overrides,
    };
  }

  const record = (event: SyncEvent): void => {
    events.push(event);
  };

  const describeEvents = (): string[] => events.map((e) => (e.type === "stage" ? e.stage : `${e.type}:${"index" in e ? e.index : ""}`));
  const requestLines = (): string[] => server.requests.map((r) => `${r.method} ${r.path}`);

  it("writes presets and registers filaments without creating spools by default", async () => {
    const { results, presets } = await runSync(options(), record);

    expect(results.map((r) => [r.bambuStatus, r.spooleaseStatus, r.detail])).toEqual([
      ["written", "written", "registered PABC1234"],
      ["written", "written", "registered Pb1a2a16"],
    ]);
    expect(presets.map((p) => p.error)).toEqual(["", ""]);
    expect(await readdir(filamentDir)).toHaveLength(2);
    expect(describeEvents()).toEqual(["presets", "preset:0", "preset:1", "key-check", "custom-filaments", "spool:0", "spool:1"]);
    expect(requestLines()).toEqual(["POST /api/test-key", "GET /api/filaments-config", "POST /api/filaments-config"]);
    expect(server.spools).toEqual([]);
  });

  it("creates one spool per filament when asked, linked by filament ID", async () => {
    const { results } = await runSync(options({ createSpools: true }), record);

    expect(results.map((r) => [r.spooleaseStatus, r.detail])).toEqual([
      ["written", 'registered PABC1234; spool created: HTTP 200: {"id":"1"}'],
      ["written", 'registered Pb1a2a16; spool created: HTTP 200: {"id":"2"}'],
    ]);
    expect(describeEvents()).toEqual(["presets", "preset:0", "preset:1", "key-check", "custom-filaments", "spools", "spool:0", "spool:1"]);
    expect(requestLines()).toEqual([
      "POST /api/test-key",
      "GET /api/filaments-config",
      "POST /api/filaments-config",
      "GET /api/spools",
      "POST /api/spools/add-edit",
      "POST /api/spools/add-edit",
    ]);
    expect(server.spools.map((s) => s.slicer_filament)).toEqual(["PABC1234", "Pb1a2a16"]);
  });

  it("does not duplicate spools on re-runs or for repeated filaments in one source", async () => {
    await runSync(options({ createSpools: true }), record);
    const { results } = await runSync(options({ createSpools: true, profiles: [profileAt(0), profileAt(2), profileAt(2)] }), record);

    expect(results.map((r) => r.detail)).toEqual([
      "registered PABC1234; spool already exists",
      'registered Pd73077d; spool created: HTTP 200: {"id":"3"}',
      "registered Pd73077d; spool already exists",
    ]);
    expect(server.spools.map((s) => s.slicer_filament)).toEqual(["PABC1234", "Pb1a2a16", "Pd73077d"]);
  });

  it("fails spool creation without creating anything when spools can't be listed", async () => {
    server.replies["GET /api/spools"] = { status: 500, body: "db locked" };

    const { results } = await runSync(options({ createSpools: true }), record);

    expect(results.every((r) => r.spooleaseStatus === "failed" && r.detail === "registered " + r.filamentId + "; listing spools failed: HTTP 500: db locked")).toBe(true);
    expect(server.spools).toEqual([]);
  });

  it("plans without touching disk or network in dry-run", async () => {
    const { results } = await runSync(options({ dryRun: true }), record);

    expect(results.map((r) => [r.bambuStatus, r.spooleaseStatus, r.detail])).toEqual([
      ["planned", "planned", "dry-run"],
      ["planned", "planned", "dry-run"],
    ]);
    expect(server.requests).toEqual([]);
    await expect(readdir(filamentDir)).rejects.toThrow("ENOENT");
  });

  it("marks SpoolEase skipped when no connection is given", async () => {
    const { results } = await runSync(options({ spoolease: null }), record);

    expect(results[0]).toEqual({ profileName: "PETG Red", filamentId: "PABC1234", bambuStatus: "written", spooleaseStatus: "skipped", detail: "SpoolEase skipped" });
  });

  it("throws KeyCheckError when the key is rejected", async () => {
    const opts = options();
    opts.spoolease = { host: "127.0.0.1", port: server.port, securityKey: "WRONG", https: false };

    await expect(runSync(opts, record)).rejects.toThrow(new KeyCheckError("SpoolEase key validation failed"));
  });

  it("throws KeyCheckError when SpoolEase is unreachable", async () => {
    await server.close();

    await expect(runSync(options(), record)).rejects.toThrow(KeyCheckError);
    await expect(runSync(options(), record)).rejects.toThrow(/SpoolEase unreachable at http:\/\/127\.0\.0\.1:\d+/);
  });

  it("fails every profile and skips spools when the CSV upload fails", async () => {
    server.replies["POST /api/filaments-config"] = { status: 500, body: "boom" };

    const { results } = await runSync(options(), record);

    expect(results.every((r) => r.spooleaseStatus === "failed" && r.detail === "custom filaments CSV: HTTP 500: boom")).toBe(true);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/test-key",
      "GET /api/filaments-config",
      "POST /api/filaments-config",
    ]);
    expect(events).toContainEqual({ type: "warning", message: "Failed to set custom filaments CSV: 500 boom" });
  });

  it("merges into custom filaments from earlier runs instead of replacing them", async () => {
    server.customFilaments = "GFX01,Hand Made,190,230,PLA\r\nPABC1234,Stale Name,1,2,PETG";

    await runSync(options({ profiles: [profileAt(0)] }), record);
    await runSync(options({ profiles: [profileAt(2)] }), record);

    expect(server.customFilaments?.split("\r\n")).toEqual([
      "GFX01,Hand Made,190,230,PLA",
      "PABC1234,Polymaker PETG Red,230,255,PETG",
      "Pd73077d,Generic Mystery Spool,200,220,PLA",
    ]);
  });

  it("leaves the custom filaments untouched when the current list can't be read", async () => {
    server.customFilaments = "GFX01,Hand Made,190,230,PLA";
    server.replies["GET /api/filaments-config"] = { status: 500, body: "flash busy" };

    const { results } = await runSync(options(), record);

    expect(server.customFilaments).toBe("GFX01,Hand Made,190,230,PLA");
    expect(server.requests.some((r) => r.method === "POST" && r.path === "/api/filaments-config")).toBe(false);
    expect(results.every((r) => r.spooleaseStatus === "failed" && r.detail === "custom filaments CSV: reading current list failed: HTTP 500: flash busy")).toBe(true);
  });

  it("fails only the profile whose spool request is rejected", async () => {
    server.replies["/api/spools/add-edit"] = { status: 500, body: "nope" };

    const { results } = await runSync(options({ createSpools: true }), record);

    expect(results[0]).toMatchObject({ spooleaseStatus: "failed", detail: "registered PABC1234; spool rejected: HTTP 500: nope" });
  });

  it("reports preset write failures alongside SpoolEase results", async () => {
    await mkdir(join(filamentDir, ".."), { recursive: true });
    await writeFile(filamentDir, "not a directory", "utf-8");

    const { results } = await runSync(options({ spoolease: null }), record);

    expect(results[0]?.bambuStatus).toBe("failed");
    expect(results[0]?.detail).toMatch(/^BambuStudio preset: EEXIST.*; SpoolEase skipped$/);
  });

  it("refuses unknown printers before writing or sending anything", async () => {
    await expect(runSync(options({ printers: ["Bambu Lab X1C 0.4 nozzle"] }), record)).rejects.toThrow(
      new SetupError(`unknown BambuStudio printer "Bambu Lab X1C 0.4 nozzle"; known printers: ${X1C_04}, Bambu Lab X1 Carbon 0.6 nozzle`),
    );
    expect(events).toEqual([]);
    expect(server.requests).toEqual([]);
  });

  it("refuses to run without BambuStudio's system profiles", async () => {
    const bare = await mkdtemp(join(tmpdir(), "bambu-hando-bare-"));
    vi.stubEnv("HOME", bare);

    await expect(runSync(options(), record)).rejects.toThrow(SetupError);
    expect(server.requests).toEqual([]);
  });
});
