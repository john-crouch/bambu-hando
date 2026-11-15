// ABOUTME: Tests for the local 3DFilamentProfiles catalog (SQLite): summaries, full records and their age, merges, brands.
// ABOUTME: Storage only: nothing here calls the API.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FilamentCatalog, recordAgeDays, recordIsStale } from "../src/filamentCatalog.js";
import type { TdfpFilament, TdfpFilamentDetail } from "../src/filamentProfiles.js";

const T0 = new Date("2026-11-15T13:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function summary(overrides: Partial<TdfpFilament> = {}): TdfpFilament {
  return {
    id: 101,
    brandKey: "sunlu",
    brandName: "Sunlu",
    materialKey: "petg",
    material: "PETG",
    materialTypeKey: null,
    materialType: null,
    color: "Vivid Yellow",
    rgb: "#FFD700",
    tdValue: null,
    discontinued: false,
    url: "https://3dfilamentprofiles.com/filament/details/101",
    ...overrides,
  };
}

function record(overrides: Partial<TdfpFilamentDetail> = {}): TdfpFilamentDetail {
  return {
    ...summary(),
    tempMin: 230,
    tempMax: 250,
    bedTempMin: 70,
    bedTempMax: 80,
    density: 1270,
    diameter: 1750,
    nominalWeight: 1000,
    spoolWeight: 189,
    chamberTemp: null,
    dryTempMax: 65,
    dryTime: 6,
    flowRatio: 0.95,
    kValue: 0.04,
    maxVolumetricSpeed: 16,
    softeningTemp: 78,
    ...overrides,
  };
}

describe("FilamentCatalog", () => {
  let path: string;
  let catalog: FilamentCatalog;

  beforeEach(async () => {
    path = join(await mkdtemp(join(tmpdir(), "bh-catalog-")), "nested", "3dfp-catalog.sqlite");
    catalog = FilamentCatalog.open(path);
  });

  afterEach(() => {
    catalog.close();
  });

  it("keeps summaries across opens", () => {
    catalog.saveSummaries([summary(), summary({ id: 102, color: "Black" })], T0);
    catalog.close();
    catalog = FilamentCatalog.open(path);
    expect(catalog.get(102)).toEqual({ filament: summary({ id: 102, color: "Black" }), summaryAt: T0, record: null, recordAt: null });
    expect(catalog.get(999)).toBeNull();
  });

  it("keeps a full record, and a later summary updates it without dropping the record", () => {
    catalog.saveRecord(101, record(), T0);
    catalog.saveSummaries([summary({ discontinued: true })], days(3));
    expect(catalog.get(101)).toEqual({
      filament: summary({ discontinued: true }),
      summaryAt: days(3),
      record: record(),
      recordAt: T0,
    });
  });

  it("follows a merge: the requested id points at the surviving one", () => {
    catalog.saveSummaries([summary({ id: 101 })], T0);
    catalog.saveRecord(101, record({ id: 205 }), T0);
    expect(catalog.get(101)?.filament.id).toBe(205);
    expect(catalog.get(205)?.record?.id).toBe(205);
    expect(catalog.stats()).toMatchObject({ filaments: 1, records: 1 });
  });

  it("says how old a record is and whether it's 30 days or more", () => {
    catalog.saveRecord(101, record(), T0);
    const entry = catalog.get(101);
    if (!entry) throw new Error("missing entry");
    expect(recordAgeDays(entry, days(29.9))).toBe(29);
    expect(recordIsStale(entry, days(29.9))).toBe(false);
    expect(recordIsStale(entry, days(30))).toBe(true);
    catalog.saveSummaries([summary({ id: 300 })], T0);
    const bare = catalog.get(300);
    if (!bare) throw new Error("missing entry");
    expect(recordAgeDays(bare, T0)).toBeNull();
    expect(recordIsStale(bare, T0)).toBe(true);
  });

  it("searches by words across brand, material, type and color, and by brand or material key", () => {
    catalog.saveSummaries(
      [
        summary(),
        summary({ id: 102, color: "Black" }),
        summary({ id: 103, brandKey: "esun", brandName: "eSUN", materialKey: "pla", material: "PLA", materialTypeKey: "matte", materialType: "Matte", color: "Light Khaki" }),
      ],
      T0,
    );
    expect(catalog.search({ words: "sunlu black" }).map((f) => f.id)).toEqual([102]);
    expect(catalog.search({ words: "MATTE khaki" }).map((f) => f.id)).toEqual([103]);
    expect(catalog.search({ brand: "sunlu" }).map((f) => f.id)).toEqual([102, 101]);
    expect(catalog.search({ material: "pla" }).map((f) => f.id)).toEqual([103]);
    expect(catalog.search({ words: "100% PLA_" })).toEqual([]);
    expect(catalog.search({}, 1)).toHaveLength(1);
  });

  it("tracks how far each fill search got, counting complete brands", () => {
    expect(catalog.fill("brand:sunlu")).toBeNull();
    catalog.saveFill({ key: "brand:sunlu", nextPage: 4, complete: false, truncated: false, updatedAt: T0 });
    catalog.saveFill({ key: "brand:esun", nextPage: 1, complete: true, truncated: true, updatedAt: days(1) });
    catalog.saveFill({ key: "brand:esun,material:pla", nextPage: 1, complete: true, truncated: false, updatedAt: days(1) });
    catalog.saveFill({ key: "all", nextPage: 21, complete: true, truncated: true, updatedAt: days(1) });
    expect(catalog.fill("brand:sunlu")).toEqual({ key: "brand:sunlu", nextPage: 4, complete: false, truncated: false, updatedAt: T0 });
    expect(catalog.fills().map((f) => f.key)).toEqual(["all", "brand:esun", "brand:esun,material:pla", "brand:sunlu"]);
    expect(catalog.stats()).toMatchObject({ completeBrands: 1 });
  });

  it("lists the material keys its filaments use, for one brand or all", () => {
    catalog.saveSummaries([summary(), summary({ id: 103, brandKey: "esun", materialKey: "pla" }), summary({ id: 104, brandKey: "esun", materialKey: "abs" })], T0);
    expect(catalog.materialKeys()).toEqual(["abs", "petg", "pla"]);
    expect(catalog.materialKeys("esun")).toEqual(["abs", "pla"]);
  });

  it("lists the brand keys its filaments use", () => {
    catalog.saveSummaries([summary(), summary({ id: 103, brandKey: "esun" })], T0);
    expect(catalog.brandKeys()).toEqual(["esun", "sunlu"]);
    expect(catalog.stats()).toEqual({ filaments: 2, records: 0, brands: 2, completeBrands: 0 });
  });
});
