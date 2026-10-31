// ABOUTME: Unit tests for empty-spool weight choices: SpoolEase catalog parsing, brand/size matching,
// ABOUTME: defaults, applying choices to profiles, and the --spool-weight argument format.

import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import {
  applyWeights,
  defaultChoice,
  describeSourceWeights,
  parseSpoolWeightArg,
  parseSpoolWeightList,
  type WeightChoice,
  weightGroups,
} from "../src/spoolWeights.js";
import { SPOOLS_CATALOG } from "./spooleaseServer.js";

const entries = parseSpoolWeightList(SPOOLS_CATALOG);

function profile(brand: string, overrides: Partial<FilamentProfile> = {}): FilamentProfile {
  return {
    name: `${brand} PLA`,
    brand,
    material: "PLA",
    colorName: "Black",
    colorRgba: "000000FF",
    nozzleTempMin: 200,
    nozzleTempMax: 220,
    density: 1.24,
    diameter: 1.75,
    slicerFilamentCode: "",
    filamentId: `P${brand.length}`,
    labelWeight: 1000,
    coreWeight: 189,
    ...overrides,
  };
}

describe("parseSpoolWeightList", () => {
  it("reads name,grams pairs, up to two per line, like SpoolEase's own spool form", () => {
    expect(entries).toHaveLength(21);
    expect(entries.slice(0, 2)).toEqual([
      { label: "3D FilaPrint - Cardboard - 210g", grams: 210, mine: false },
      { label: "3DXTech - Plastic - 258g", grams: 258, mine: false },
    ]);
    expect(entries.filter((e) => e.label.startsWith("Sunlu - Plastic (2.0"))).toEqual([
      { label: "Sunlu - Plastic (2.0 Version) - 165g", grams: 165, mine: false },
      { label: "Sunlu - Plastic (2.0 Version) - 202g", grams: 202, mine: false },
    ]);
  });

  it("marks entries from the user's own list and skips lines without a number", () => {
    expect(parseSpoolWeightList("Sunlu 2.0 weighed,171\r\nnot a weight\n", true)).toEqual([
      { label: "Sunlu 2.0 weighed", grams: 171, mine: true },
    ]);
  });
});

describe("weightGroups", () => {
  it("groups profiles by brand ignoring case and spacing, keeping first-seen order", () => {
    const profiles = [profile("Sunlu"), profile("PolyMaker"), profile("SUNLU")];
    const groups = weightGroups(profiles, entries);

    expect(groups.map((g) => [g.brand, g.profiles])).toEqual([
      ["Sunlu", [0, 2]],
      ["PolyMaker", [1]],
    ]);
  });

  it("offers the brand's catalog rows for the filaments' size, one per weight", () => {
    const [sunlu] = weightGroups([profile("Sunlu")], entries);

    expect(sunlu?.options.map((o) => o.label)).toEqual([
      "Sunlu - Plastic - 117g",
      "Sunlu - Plastic - 150g",
      "Sunlu - Plastic (2.0 Version) - 165g",
      "Sunlu - Plastic (2.0 Version) - 202g",
      "Sunlu - V3 - 179g",
      "Sunlu V3 with Cardboard - 219g",
      "Sunlu - Plastic - 124g",
    ]);
  });

  it("matches sized rows such as 3kg only to filaments of that size", () => {
    const [big] = weightGroups([profile("Polymaker", { labelWeight: 3000 })], entries);
    const [small] = weightGroups([profile("Sunlu", { labelWeight: 250 })], entries);

    expect(big?.options.map((o) => o.grams)).toEqual([418, 462]);
    expect(small?.options.map((o) => o.grams)).toEqual([55]);
  });

  it("merges rows with the same weight and lists the user's own spools first", () => {
    const mine = parseSpoolWeightList("3DXTECH scale reading,262", true);
    const [group] = weightGroups([profile("3DXTECH")], [...entries, ...mine]);

    expect(group?.options).toEqual([
      { label: "3DXTECH scale reading", grams: 262, mine: true },
      { label: "3DXTech - Plastic - 258g", grams: 258, mine: false },
    ]);
  });

  it("finds nothing for unknown or empty brands", () => {
    const groups = weightGroups([profile("Acme"), profile("")], entries);
    expect(groups.map((g) => g.options)).toEqual([[], []]);
  });
});

describe("choices", () => {
  const profiles = [profile("Sunlu"), profile("Flashforge", { coreWeight: 120 }), profile("Acme", { coreWeight: 0 })];
  const groups = weightGroups(profiles, entries);

  it("defaults a single catalog row to its weight, no row to the source's, and asks otherwise", () => {
    expect(groups.map(defaultChoice)).toEqual([null, { kind: "grams", grams: 167 }, { kind: "source" }]);
  });

  it("applies chosen weights to every profile of the brand, defaults to the rest", () => {
    const choices = new Map<string, WeightChoice>([
      ["sunlu", { kind: "grams", grams: 165 }],
      ["acme", { kind: "unspecified" }],
    ]);
    expect(applyWeights(profiles, groups, choices).map((p) => p.coreWeight)).toEqual([165, 167, 0]);
  });

  it("keeps the source's weight when asked to, or when a brand was left undecided", () => {
    const keep = new Map<string, WeightChoice>([["flashforge", { kind: "source" }]]);
    expect(applyWeights(profiles, groups, keep).map((p) => p.coreWeight)).toEqual([189, 120, 0]);
  });

  it("describes the source's weights for a brand", () => {
    const mixed = [profile("Acme", { coreWeight: 170 }), profile("Acme", { coreWeight: 120 }), profile("Acme", { coreWeight: 0 })];
    const [acme] = weightGroups(mixed, entries);
    const [unknown] = weightGroups([profile("Acme", { coreWeight: 0 })], entries);

    expect(describeSourceWeights(mixed, acme!)).toBe("120–170 g");
    expect(describeSourceWeights(mixed.slice(0, 1), weightGroups(mixed.slice(0, 1), entries)[0]!)).toBe("170 g");
    expect(describeSourceWeights([profile("Acme", { coreWeight: 0 })], unknown!)).toBe("unknown");
  });
});

describe("parseSpoolWeightArg", () => {
  it("reads brand=grams, brand=spoolmandb and brand=unspecified", () => {
    expect(parseSpoolWeightArg("Sunlu=165")).toEqual({ key: "sunlu", brand: "Sunlu", choice: { kind: "grams", grams: 165 } });
    expect(parseSpoolWeightArg("Das Filament = spoolmandb")).toEqual({
      key: "dasfilament",
      brand: "Das Filament",
      choice: { kind: "source" },
    });
    expect(parseSpoolWeightArg("Acme=Unspecified").choice).toEqual({ kind: "unspecified" });
  });

  it("rejects anything else", () => {
    for (const bad of ["Sunlu", "=165", "Sunlu=", "Sunlu=heavy", "Sunlu=-3", "Sunlu=16.5"]) {
      expect(() => parseSpoolWeightArg(bad), bad).toThrow(/--spool-weight/);
    }
  });
});
