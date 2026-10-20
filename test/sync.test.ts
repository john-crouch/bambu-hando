// ABOUTME: Integration tests for sync orchestration against a local SpoolEase server.
// ABOUTME: Covers statuses, progress events, and failure handling for both integrations.

import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeyCheckError, runSync, type SyncEvent, type SyncOptions } from "../src/sync.js";
import { profileAt } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

describe("runSync", () => {
  let server: SpoolEaseServer;
  let filamentDir: string;
  let events: SyncEvent[];

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    filamentDir = join(home, ".config", "BambuStudio", "user", "default", "filament");
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
      printerPreset: "X1C",
      dryRun: false,
      spoolease: { host: "127.0.0.1", port: server.port, securityKey: TEST_SECURITY_KEY, https: false },
      ...overrides,
    };
  }

  const record = (event: SyncEvent): void => {
    events.push(event);
  };

  it("writes presets and spools, emitting progress in order", async () => {
    const { results, presets } = await runSync(options(), record);

    expect(results.map((r) => [r.bambuStatus, r.spooleaseStatus])).toEqual([
      ["written", "written"],
      ["written", "written"],
    ]);
    expect(presets.map((p) => p.error)).toEqual(["", ""]);
    expect(await readdir(filamentDir)).toHaveLength(2);
    expect(events.map((e) => (e.type === "stage" ? e.stage : `${e.type}:${"index" in e ? e.index : ""}`))).toEqual([
      "presets",
      "preset:0",
      "preset:1",
      "key-check",
      "custom-filaments",
      "spools",
      "spool:0",
      "spool:1",
    ]);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/test-key",
      "GET /api/filaments-config",
      "POST /api/filaments-config",
      "POST /api/spools/add-edit",
      "POST /api/spools/add-edit",
    ]);
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

    const { results } = await runSync(options({ profiles: [profileAt(0)] }), record);

    expect(results[0]).toMatchObject({ spooleaseStatus: "failed", detail: "HTTP 500: nope" });
  });

  it("reports preset write failures alongside SpoolEase results", async () => {
    await mkdir(join(filamentDir, ".."), { recursive: true });
    await writeFile(filamentDir, "not a directory", "utf-8");

    const { results } = await runSync(options({ spoolease: null }), record);

    expect(results[0]?.bambuStatus).toBe("failed");
    expect(results[0]?.detail).toMatch(/^BambuStudio preset: EEXIST.*; SpoolEase skipped$/);
  });
});
