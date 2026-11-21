// ABOUTME: Unit tests for the spool inventory: filament left on each spool, filtering by words and sorting.
// ABOUTME: Pure functions over spool records as SpoolEase serves them.

import { describe, expect, it } from "vitest";

import type { SpoolRecord } from "../src/spoolease.js";
import { inventoryRows, remainingGrams } from "../src/spoolInventory.js";

function spool(overrides: Partial<SpoolRecord>): SpoolRecord {
  return {
    id: "1",
    tagId: "",
    material: "PLA",
    subtype: "",
    colorName: "Red",
    colorCodes: [],
    note: "",
    brand: "Acme",
    labelWeight: 1000,
    coreWeight: 200,
    fullWeight: null,
    currentWeight: null,
    consumedSinceWeighed: 0,
    slicerFilament: "",
    addedTime: null,
    location: "",
    ...overrides,
  };
}

describe("remainingGrams", () => {
  it("is the last weight less the core and what was printed since, as SpoolEase works it out", () => {
    expect(remainingGrams(spool({ currentWeight: 753, coreWeight: 189 }))).toBe(564);
    expect(
      remainingGrams(spool({ currentWeight: 753, coreWeight: 189, consumedSinceWeighed: 12.4 })),
    ).toBe(552);
  });

  it("uses the full weight less the label weight as the core when the core is unknown", () => {
    expect(
      remainingGrams(
        spool({ currentWeight: 900, coreWeight: null, fullWeight: 1180, labelWeight: 1000 }),
      ),
    ).toBe(720);
  });

  it("is unknown until the spool is weighed, or without a core or full weight", () => {
    expect(remainingGrams(spool({ currentWeight: null }))).toBeNull();
    expect(
      remainingGrams(spool({ currentWeight: 900, coreWeight: null, fullWeight: null })),
    ).toBeNull();
  });

  it("never goes below zero", () => {
    expect(
      remainingGrams(spool({ currentWeight: 210, coreWeight: 200, consumedSinceWeighed: 30 })),
    ).toBe(0);
  });
});

describe("inventoryRows", () => {
  const SPOOLS = [
    spool({
      id: "1",
      brand: "Sunlu",
      material: "PETG",
      colorName: "Red",
      currentWeight: 700,
      location: "Shelf B",
      slicerFilament: "PA000001",
    }),
    spool({
      id: "2",
      brand: "Acme",
      material: "PLA",
      colorName: "Blue",
      currentWeight: 400,
      location: "AMS 1",
    }),
    spool({ id: "10", brand: "Acme", material: "PLA", colorName: "Green", location: "" }),
  ];
  const names = new Map([
    ["PA000001", { name: "Sunlu PETG Elite Red", nozzleTempMin: 240, nozzleTempMax: 260 }],
  ]);
  const ids = (rows: { spool: SpoolRecord }[]) => rows.map((r) => r.spool.id);

  it("names each spool from its custom filament, else brand, material and color, with what's left", () => {
    const rows = inventoryRows(SPOOLS, names, "", "newest");
    expect(rows.map((r) => [r.spool.id, r.name, r.left])).toEqual([
      ["10", "Acme PLA Green", null],
      ["2", "Acme PLA Blue", 200],
      ["1", "Sunlu PETG Elite Red", 500],
    ]);
    expect(rows[1]!.fraction).toBe(0.2);
    expect(rows[0]!.fraction).toBeNull();
  });

  it("sorts by name, by least left (unweighed last), or by location (none last)", () => {
    expect(ids(inventoryRows(SPOOLS, names, "", "name"))).toEqual(["2", "10", "1"]);
    expect(ids(inventoryRows(SPOOLS, names, "", "left"))).toEqual(["2", "1", "10"]);
    expect(ids(inventoryRows(SPOOLS, names, "", "location"))).toEqual(["2", "1", "10"]);
  });

  it("keeps spools matching every word typed, in the name, location, code or #id", () => {
    expect(ids(inventoryRows(SPOOLS, names, "acme pla", "newest"))).toEqual(["10", "2"]);
    expect(ids(inventoryRows(SPOOLS, names, "elite", "newest"))).toEqual(["1"]);
    expect(ids(inventoryRows(SPOOLS, names, "shelf", "newest"))).toEqual(["1"]);
    expect(ids(inventoryRows(SPOOLS, names, "#10", "newest"))).toEqual(["10"]);
    expect(ids(inventoryRows(SPOOLS, names, "PA000001", "newest"))).toEqual(["1"]);
  });
});
