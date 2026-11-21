// ABOUTME: Tests the shell's resource loaders and helpers against the stand-in SpoolEase and SpoolmanDB servers.
// ABOUTME: Covers when the console counts as set up, what a settings change reloads, and the header's status.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  affectedResources,
  consoleConfigured,
  DEFAULT_LOADERS,
  headerStatus,
  printerText,
  reloading,
} from "../src/tui/app/resources.js";
import type { FormValues } from "../src/tui/core/values.js";
import { baseFilamentDir, installBambuStudio } from "./bambuStudioSetup.js";
import { values } from "./shellFixtures.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { type SpoolmanDbServer, startSpoolmanDbServer } from "./spoolmanDbServer.js";

describe("consoleConfigured", () => {
  it("needs a host and a key, and SpoolEase not skipped", () => {
    expect(consoleConfigured(values())).toBe(true);
    expect(consoleConfigured(values({ host: " " }))).toBe(false);
    expect(consoleConfigured(values({ securityKey: "" }))).toBe(false);
    expect(consoleConfigured(values({ skipSpoolease: true }))).toBe(false);
  });
});

describe("affectedResources", () => {
  it("reloads what depends on the changed settings", () => {
    expect(affectedResources(values(), values({ presetFolder: "other" }))).toEqual([
      "presets",
      "check",
    ]);
    expect(affectedResources(values(), values({ host: "10.0.0.6" }))).toEqual(["console", "check"]);
    expect(affectedResources(values(), values({ securityKey: "X" }))).toEqual(["console", "check"]);
    expect(affectedResources(values(), values({ skipSpoolease: true }))).toEqual([
      "console",
      "check",
    ]);
    expect(affectedResources(values(), values({ diameter: 2.85 }))).toEqual(["catalog"]);
    expect(affectedResources(values(), values({ createSpools: false }))).toEqual([]);
  });
});

describe("reloading", () => {
  it("keeps the last good value on screen", () => {
    expect(reloading({ state: "ready", value: 1, at: 5 })).toEqual({
      state: "loading",
      previous: 1,
    });
    expect(reloading({ state: "failed", error: "x", previous: 2 })).toEqual({
      state: "loading",
      previous: 2,
    });
    expect(reloading({ state: "loading", previous: 3 })).toEqual({ state: "loading", previous: 3 });
    expect(reloading({ state: "idle" })).toEqual({ state: "loading" });
  });
});

describe("printerText", () => {
  it("shortens BambuStudio's printer names", () => {
    expect(printerText("Bambu Lab X1 Carbon 0.6 nozzle")).toBe("X1C 0.6");
    expect(printerText("Bambu Lab P1S 0.4 nozzle, Bambu Lab X1 Carbon 0.4 nozzle")).toBe(
      "P1S 0.4 +1",
    );
    expect(printerText("")).toBe("");
  });
});

describe("headerStatus", () => {
  it("follows the console resource and never shows the key", () => {
    const v = values();
    expect(headerStatus(v, { state: "loading" })).toEqual({
      console: "checking",
      consoleText: "SpoolEase 10.0.0.5",
      printerText: "X1C 0.4",
    });
    expect(headerStatus(v, { state: "ready", value: null, at: 1 }).console).toBe("ok");
    expect(headerStatus(v, { state: "failed", error: "nope" }).console).toBe("failed");
    expect(headerStatus(values({ skipSpoolease: true }), { state: "idle" })).toMatchObject({
      console: "skipped",
      consoleText: "SpoolEase skipped",
    });
    expect(headerStatus(values({ host: "" }), { state: "idle" })).toMatchObject({
      console: "skipped",
      consoleText: "SpoolEase not set up",
    });
    expect(JSON.stringify(headerStatus(v, { state: "ready", value: null, at: 1 }))).not.toContain(
      "SECRET",
    );
  });
});

describe("default loaders", () => {
  let server: SpoolEaseServer;
  let db: SpoolmanDbServer;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bh-shell-res-"));
    await installBambuStudio(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CACHE_HOME", join(home, ".cache"));
    server = await startSpoolEaseServer();
    db = await startSpoolmanDbServer();
    vi.stubEnv("SPOOLMANDB_URL", db.url);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await server.close();
    await db.close();
  });

  const consoleValues = (overrides: Partial<FormValues> = {}) =>
    values({
      host: "127.0.0.1",
      port: String(server.port),
      securityKey: TEST_SECURITY_KEY,
      ...overrides,
    });

  it("reads the console's spools and custom filaments", async () => {
    server.customFilaments = "PABC1234,Polymaker PLA Red,190,230\r\n";
    server.spools.push({ id: "1", slicer_filament: "PABC1234", brand: "Polymaker" });

    const data = await DEFAULT_LOADERS.console(consoleValues());

    expect(data?.spools.map((s) => s.id)).toEqual(["1"]);
    expect(data?.filaments.get("PABC1234")?.name).toBe("Polymaker PLA Red");
  });

  it("is idle without a console and fails on a rejected key", async () => {
    expect(DEFAULT_LOADERS.console(consoleValues({ skipSpoolease: true }))).toBeNull();
    expect(DEFAULT_LOADERS.check(consoleValues({ host: "" }))).toBeNull();
    await expect(DEFAULT_LOADERS.console(consoleValues({ securityKey: "WRONG" }))).rejects.toThrow(
      "SpoolEase key validation failed",
    );
  });

  it("reads the preset folder's presets", async () => {
    const dir = baseFilamentDir(home);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "Acme PLA @Bambu Lab X1 Carbon 0.4 nozzle.json"),
      JSON.stringify({ name: "Acme PLA @Bambu Lab X1 Carbon 0.4 nozzle", filament_id: "P1234567" }),
    );

    const data = await DEFAULT_LOADERS.presets(consoleValues());

    expect(data?.presets.map((p) => [p.name, p.filamentId])).toEqual([["Acme PLA", "P1234567"]]);
  });

  it("loads the SpoolmanDB catalog for the diameter", async () => {
    const catalog = await DEFAULT_LOADERS.catalog(consoleValues());

    expect(catalog?.profiles.length).toBeGreaterThan(0);
    expect(db.requests.map((r) => r.path).sort()).toEqual(["/filaments.json", "/materials.json"]);
  });

  it("runs the sync check against the console", async () => {
    server.spools.push({ id: "7", slicer_filament: "PNOPE000", brand: "Acme" });

    const check = await DEFAULT_LOADERS.check(consoleValues());

    expect(check?.sections.some((s) => s.items.some((i) => i.includes("#7")))).toBe(true);
  });
});
