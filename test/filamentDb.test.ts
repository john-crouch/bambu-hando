// ABOUTME: Tests reading filament-db's JSON export: lookups by 3DFP and SpoolmanDB id, presets per printer and nozzle.
// ABOUTME: Uses a trimmed real export (test/fixtures/filament-db); a missing file is no export, another schema a warning.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { FilamentDb, filamentDbPath, loadFilamentDb, presetFor } from "../src/filamentDb.js";
import { FILAMENT_DB_FIXTURE } from "./filamentDbFixture.js";

const X1C_04 = { model: "Bambu Lab X1 Carbon", nozzleMm: 0.4 };

async function fixtureDoc(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(FILAMENT_DB_FIXTURE, "utf-8"));
}

async function written(doc: unknown): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "bh-fdb-")), "catalog.json");
  await writeFile(path, typeof doc === "string" ? doc : JSON.stringify(doc), "utf-8");
  return path;
}

describe("filamentDbPath", () => {
  it("is FILAMENT_DB_EXPORT when set", () => {
    expect(filamentDbPath({ FILAMENT_DB_EXPORT: "/x/catalog.json" }, "/home/me")).toBe(
      "/x/catalog.json",
    );
  });

  it("is filament-db's own data folder otherwise, as filament-db's paths.py picks it", () => {
    expect(filamentDbPath({ XDG_DATA_HOME: "/data" }, "/home/me")).toBe(
      "/data/filament-db/export/catalog.json",
    );
    expect(filamentDbPath({}, "/home/me")).toBe(
      "/home/me/.local/share/filament-db/export/catalog.json",
    );
  });
});

describe("loadFilamentDb", () => {
  it("is no export, silently, when there's no file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bh-fdb-none-"));
    expect(await loadFilamentDb(join(dir, "catalog.json"))).toEqual({ db: null, warning: null });
  });

  it("treats another schema_version as no export, with a warning", async () => {
    const path = await written({ ...(await fixtureDoc()), schema_version: 3 });
    const { db, warning } = await loadFilamentDb(path);
    expect(db).toBeNull();
    expect(warning).toBe(
      `filament-db's export ${path} has schema_version 3, not 2: bambu-hando ignores it`,
    );
  });

  it("treats a file that isn't JSON as no export, with a warning", async () => {
    const path = await written("{ not json");
    const { db, warning } = await loadFilamentDb(path);
    expect(db).toBeNull();
    expect(warning).toMatch(/^couldn't read filament-db's export .*: /);
  });

  it("parses a file once per run", async () => {
    const path = await written(await fixtureDoc());
    const first = await loadFilamentDb(path);
    await writeFile(path, "{ not json", "utf-8");
    expect(await loadFilamentDb(path)).toBe(first);
  });

  it("ignores fields it doesn't know", async () => {
    const doc = await fixtureDoc();
    const path = await written({ ...doc, added_later: { anything: true } });
    expect((await loadFilamentDb(path)).db?.lineForTdfp(16899)?.line.id).toBe(1383);
  });
});

describe("FilamentDb lookups", () => {
  let db: FilamentDb;

  beforeAll(async () => {
    db = FilamentDb.parse(await fixtureDoc());
  });

  it("finds a 3DFP filament's line through the tdfp index", () => {
    const found = db.lineForTdfp(16899);
    expect(found?.line).toMatchObject({
      id: 1383,
      brand: "Polymaker",
      material: "ASA",
      name: "ASA",
    });
  });

  it("finds a SpoolmanDB entry's line through its color's spoolmandb_ids", () => {
    expect(db.lineForSpoolmanDb("polymaker_asa_polyliteblack_1000_175_c")?.line.name).toBe(
      "Polylite ASA",
    );
    expect(db.lineForSpoolmanDb("3do_petg_black_1000_175_n")?.line).toMatchObject({
      id: 68,
      brand: "3DO",
    });
  });

  it("finds nothing for ids it doesn't know", () => {
    expect(db.lineForTdfp(1)).toBeNull();
    expect(db.lineForSpoolmanDb("acme_pla_red_1000_175_n")).toBeNull();
  });

  it("looks a profile's line up by its 3DFP id first, then its SpoolmanDB id", () => {
    expect(db.lineFor({ tdfp: 16899, spoolmanDb: "3do_petg_black_1000_175_n" })?.line.id).toBe(
      1383,
    );
    expect(db.lineFor({ spoolmanDb: "3do_petg_black_1000_175_n" })?.line.id).toBe(68);
    expect(db.lineFor(undefined)).toBeNull();
  });

  it("follows tdfp_aliases for a merged 3DFP id", async () => {
    // The real export has no merged ids yet, so this one alias is added to the real fixture.
    const doc = await fixtureDoc();
    const aliased = FilamentDb.parse({ ...doc, tdfp_aliases: { "99999": 16899 } });
    expect(aliased.lineForTdfp(99999)?.line.id).toBe(1383);
    expect(aliased.tdfpRecord(99999)).toBeNull();
  });

  it("gives a 3DFP record in TdfpFilamentDetail's shape with when it was fetched", () => {
    const found = db.tdfpRecord(32336);
    expect(found?.fetchedAt).toEqual(new Date("2026-11-27T18:03:20.800Z"));
    expect(found?.record).toEqual({
      id: 32336,
      brandKey: "creality",
      brandName: "Creality",
      materialKey: "petg",
      material: "PETG",
      materialTypeKey: "basic",
      materialType: "Basic",
      color: "Transparent Wine Red",
      rgb: "#5C0A0A",
      tdValue: null,
      discontinued: false,
      url: "https://3dfilamentprofiles.com/filament/details/32336",
      tempMin: 230,
      tempMax: 250,
      bedTempMin: 70,
      bedTempMax: 90,
      density: 1270,
      diameter: 1750,
      nominalWeight: 1000,
      spoolWeight: 186,
      chamberTemp: null,
      dryTempMax: 65,
      dryTime: 12,
      flowRatio: 0.95,
      kValue: null,
      maxVolumetricSpeed: 8,
      softeningTemp: 85,
    });
  });

  it("has no record for a filament known only from a search", () => {
    expect(db.tdfpRecord(16899)).toBeNull();
  });

  it("keeps a line's properties with each value's tier", () => {
    const { properties } = db.lineForTdfp(16899)!;
    expect(properties.nozzle_min_c).toMatchObject({ value: 230, tier: "manufacturer_preset" });
    expect(properties.bed_min_c).toMatchObject({ value: 75, tier: "community" });
  });

  it("keeps a line's material settings", () => {
    expect(db.lineForTdfp(16899)?.line.materialSettings.temperature_vitrification).toMatchObject({
      value: ["105"],
      tier: "manufacturer_preset",
    });
  });
});

describe("presetFor", () => {
  let db: FilamentDb;

  beforeAll(async () => {
    db = FilamentDb.parse(await fixtureDoc());
  });

  const line = () => db.lineForTdfp(16899)!.line;

  it("takes the line's own preset for the printer and nozzle", () => {
    const preset = presetFor(line(), { model: "Bambu Lab H2D", nozzleMm: 0.4 });
    expect(preset).toMatchObject({ printer: "Bambu Lab H2D", nozzleMm: 0.4 });
    expect(preset?.extruderVariants).toEqual(["Direct Drive Standard", "Direct Drive High Flow"]);
    expect(preset?.settings.fan_max_speed).toMatchObject({
      value: ["90"],
      tier: "manufacturer_preset",
    });
  });

  it("matches the nozzle as well as the printer", () => {
    expect(presetFor(line(), X1C_04)?.nozzleMm).toBe(0.4);
    expect(presetFor(line(), { ...X1C_04, nozzleMm: 0.2 })?.nozzleMm).toBe(0.2);
    expect(presetFor(line(), { ...X1C_04, nozzleMm: 0.6 })).toBeNull();
  });

  it("falls back to a preset that fills in for the printer", () => {
    const preset = presetFor(line(), { model: "Bambu Lab X1", nozzleMm: 0.4 });
    expect(preset?.fillsInFor).toContain("Bambu Lab X1");
    expect(preset?.settings.fan_min_speed?.value).toEqual(["5"]);
  });

  it("has none for a printer nothing fills in for", () => {
    expect(presetFor(line(), { model: "Bambu Lab A1", nozzleMm: 0.4 })).toBeNull();
  });

  it("keeps a value's suspect", () => {
    const preset = presetFor(line(), { ...X1C_04, nozzleMm: 0.2 });
    expect(preset?.settings.filament_max_volumetric_speed?.suspect).toBe(
      "0.2 nozzle keeps the 0.4 nozzle's max volumetric speed",
    );
  });
});
