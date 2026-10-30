// ABOUTME: Tests SpoolmanDB catalog conversion, filtering, and the cached download.
// ABOUTME: Uses real SpoolmanDB entries as fixtures and a local server with ETag support.

import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { catalogProfiles, filterProfiles, loadSpoolmanDb } from "../src/spoolmanDb.js";
import { SPOOLMANDB_FIXTURE_DIR, startSpoolmanDbServer, type SpoolmanDbServer } from "./spoolmanDbServer.js";

const filaments: unknown = JSON.parse(readFileSync(new URL("filaments.json", SPOOLMANDB_FIXTURE_DIR), "utf-8"));
const materials: unknown = JSON.parse(readFileSync(new URL("materials.json", SPOOLMANDB_FIXTURE_DIR), "utf-8"));

// filamentId values computed independently: "P" + first 7 hex of `printf '%s' "<name>" | md5sum`.
const EXPECTED_175 = [
  ["Peddfd02", "Polymaker PolyLite™ PETG Black"],
  ["P4ae198e", "3DXTECH ABS 3DXTECH™ Alpine Green"],
  ["Pccd78d1", "3DHoJor ABS+ Brown"],
  ["Pd6ef068", "3DHoJor PLA-CF Brown"],
  ["Pdb6c606", "3DHoJor PLA Crystal Rainbow Flame"],
  ["P0a5ea56", "3D Printing Canada PLA Budget Latte"],
  ["P7679687", "3DO PETG Black"],
  ["P9a3bd74", "RatRig ABS Punkfil Brute Black"],
  ["Pc2a964c", "3DXTECH HIPS 3DXMAX™ Clear"],
];

function byName(name: string) {
  const profile = catalogProfiles(filaments, materials, 1.75).find((p) => p.name === name);
  if (!profile) throw new Error(`no profile named ${name}`);
  return profile;
}

describe("catalogProfiles", () => {
  it("maps a SpoolmanDB filament onto a profile", () => {
    expect(byName("Polymaker PolyLite™ PETG Black")).toEqual({
      name: "Polymaker PolyLite™ PETG Black",
      brand: "Polymaker",
      material: "PETG",
      colorName: "PolyLite™ PETG Black",
      colorRgba: "101820FF",
      nozzleTempMin: 230,
      nozzleTempMax: 240,
      density: 1.25,
      diameter: 1.75,
      slicerFilamentCode: "",
      filamentId: "Peddfd02",
      labelWeight: 1000,
      coreWeight: 140,
    });
  });

  it("names products by manufacturer and material, keeps one per name, and skips Bambu Lab", () => {
    expect(catalogProfiles(filaments, materials, 1.75).map((p) => [p.filamentId, p.name])).toEqual(EXPECTED_175);
  });

  it("only includes the requested diameter", () => {
    const profiles = catalogProfiles(filaments, materials, 2.85);
    expect(profiles.map((p) => [p.name, p.diameter])).toEqual([["Polymaker PolyLite™ PETG Black", 2.85]]);
  });

  it("uses a single extruder temperature as both ends of the range", () => {
    expect(byName("RatRig ABS Punkfil Brute Black")).toMatchObject({ nozzleTempMin: 245, nozzleTempMax: 245 });
  });

  it("falls back to the material's temperature, then to 190-240", () => {
    expect(byName("3D Printing Canada PLA Budget Latte")).toMatchObject({ nozzleTempMin: 210, nozzleTempMax: 210 });
    expect(byName("3DO PETG Black")).toMatchObject({ nozzleTempMin: 190, nozzleTempMax: 240 });
  });

  it("rounds spool weights to whole grams and sends 0 when the spool weight is unknown", () => {
    expect(byName("RatRig ABS Punkfil Brute Black")).toMatchObject({ labelWeight: 1000, coreWeight: 219 });
    expect(byName("3DO PETG Black")).toMatchObject({ labelWeight: 1000, coreWeight: 0 });
  });

  it("uses the first color of multi-color filaments and keeps alpha from 8-digit hex", () => {
    expect(byName("3DHoJor PLA Crystal Rainbow Flame").colorRgba).toBe("DF6360FF");
    expect(byName("3DXTECH HIPS 3DXMAX™ Clear").colorRgba).toBe("00FFFFFF");
  });

  it("skips malformed entries", () => {
    const entries = [null, "PLA", { manufacturer: "Acme", material: "PLA", diameter: 1.75 }, { manufacturer: "Acme", name: "Red", material: "PLA", diameter: 1.75 }];
    expect(catalogProfiles(entries, materials, 1.75).map((p) => p.name)).toEqual(["Acme PLA Red"]);
  });

  it("rejects a catalog that isn't a list", () => {
    expect(() => catalogProfiles({ filaments: [] }, materials, 1.75)).toThrow("SpoolmanDB filaments.json is not a list");
  });
});

describe("filterProfiles", () => {
  const all = catalogProfiles(filaments, materials, 1.75);
  const names = (filters: Partial<Parameters<typeof filterProfiles>[1]>) =>
    filterProfiles(all, { brand: "", material: "", match: "", ...filters }).map((p) => p.name);

  it("matches brand and material case-insensitively and exactly", () => {
    expect(names({ brand: "3dhojor", material: "pla" })).toEqual(["3DHoJor PLA Crystal Rainbow Flame"]);
  });

  it("requires every --match word somewhere in the name", () => {
    expect(names({ match: "black ABS" })).toEqual(["RatRig ABS Punkfil Brute Black"]);
    expect(names({ match: "polylite" })).toEqual(["Polymaker PolyLite™ PETG Black"]);
  });

  it("keeps everything without filters", () => {
    expect(names({})).toHaveLength(EXPECTED_175.length);
  });
});

describe("loadSpoolmanDb", () => {
  let server: SpoolmanDbServer;
  let cacheDir: string;

  beforeEach(async () => {
    server = await startSpoolmanDbServer();
    cacheDir = join(await mkdtemp(join(tmpdir(), "bambu-hando-cache-")), "bambu-hando");
  });

  afterEach(async () => {
    await server.close();
  });

  const load = () => loadSpoolmanDb({ baseUrl: server.url, cacheDir, diameter: 1.75 });

  it("downloads the catalog and caches both files", async () => {
    const { profiles, warnings } = await load();

    expect(profiles.map((p) => p.filamentId)).toEqual(EXPECTED_175.map(([id]) => id));
    expect(warnings).toEqual([]);
    expect(await readFile(join(cacheDir, "filaments.json"), "utf-8")).toBe(server.files.get("/filaments.json"));
    expect(await readFile(join(cacheDir, "materials.json"), "utf-8")).toBe(server.files.get("/materials.json"));
  });

  it("revalidates with the cached ETag and reuses the cache on 304", async () => {
    await load();
    server.requests.length = 0;

    const { profiles, warnings } = await load();

    expect(profiles).toHaveLength(EXPECTED_175.length);
    expect(warnings).toEqual([]);
    expect(server.requests.map((r) => r.path).sort()).toEqual(["/filaments.json", "/materials.json"]);
    expect(server.requests.every((r) => typeof r.headers["if-none-match"] === "string")).toBe(true);
  });

  it("replaces the cache when the catalog changed", async () => {
    await load();
    server.files.set("/filaments.json", JSON.stringify([{ manufacturer: "Acme", name: "Red", material: "PLA", diameter: 1.75 }]));

    const { profiles } = await load();

    expect(profiles.map((p) => p.name)).toEqual(["Acme PLA Red"]);
  });

  it("falls back to the cache with a warning when SpoolmanDB fails", async () => {
    await load();
    server.failWith = 503;

    const { profiles, warnings } = await load();

    expect(profiles).toHaveLength(EXPECTED_175.length);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^SpoolmanDB filaments\.json could not be refreshed \(HTTP 503\); using the copy cached on \d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to the cache when SpoolmanDB is unreachable", async () => {
    await load();
    await server.close();

    const { profiles, warnings } = await load();

    expect(profiles).toHaveLength(EXPECTED_175.length);
    expect(warnings[0]).toContain("could not be refreshed");
  });

  it("fails without a cache when SpoolmanDB fails", async () => {
    server.failWith = 503;
    await expect(load()).rejects.toThrow(`Failed to download ${server.url}/filaments.json: HTTP 503`);
  });
});
