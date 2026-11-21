// ABOUTME: Tests for the Add tab's catalog views: drill-down rows, search, selection order, tray line and detail data.
// ABOUTME: Pure functions over profiles, so every level is checked without rendering.

import { describe, expect, it } from "vitest";

import {
  dbKey,
  findDetail,
  importKey,
  importSourceOf,
  levelRows,
  type Sources,
  searchRows,
  selectedEntries,
  trayText,
} from "../src/tui/tabs/add/catalog.js";
import { PROFILES, profile, values } from "./tabAddHarness.js";

const IMPORTED = [
  profile({ brand: "Mine", colorName: "Teal", filamentId: "PMINTEAL" }),
  profile({ brand: "Mine", colorName: "Gold", filamentId: "PMINGOLD" }),
];

const sources: Sources = { db: PROFILES, imported: IMPORTED, importName: "mine.json" };
const none = new Set<string>();

describe("importSourceOf", () => {
  it("is the source when it's a file or URL, not SpoolmanDB or nothing", () => {
    expect(importSourceOf(values({ source: " ./mine.json " }))).toBe("./mine.json");
    expect(importSourceOf(values({ source: "spoolmandb" }))).toBeNull();
    expect(importSourceOf(values({ source: "" }))).toBeNull();
  });
});

describe("levelRows", () => {
  it("lists the two sources at the root with counts and ticks", () => {
    const rows = levelRows({ kind: "root" }, sources, new Set([importKey(0), dbKey(PROFILES[0]!)]));
    expect(rows).toEqual([
      { kind: "source", source: "db", label: "SpoolmanDB", count: 5, ticked: 1 },
      { kind: "source", source: "import", label: "mine.json", count: 2, ticked: 1 },
    ]);
  });

  it("lists brands sorted, with counts and ticked counts", () => {
    const rows = levelRows({ kind: "brands" }, sources, new Set([dbKey(PROFILES[1]!)]));
    expect(rows).toEqual([
      { kind: "brand", label: "Acme", count: 4, ticked: 1 },
      { kind: "brand", label: "Sunlu", count: 1, ticked: 0 },
    ]);
  });

  it("lists a brand's materials", () => {
    expect(levelRows({ kind: "materials", brand: "Acme" }, sources, none)).toEqual([
      { kind: "material", label: "PETG", count: 1, ticked: 0 },
      { kind: "material", label: "PLA", count: 3, ticked: 0 },
    ]);
  });

  it("lists colors sorted by name, then Other color…", () => {
    const rows = levelRows({ kind: "colors", brand: "Acme", material: "PLA" }, sources, none);
    expect(rows.map((r) => r.label)).toEqual(["Black", "Blue", "Red", "Other color…"]);
    expect(rows[0]).toMatchObject({ kind: "color", key: "db:PACMBLK0" });
    expect(rows.at(-1)).toEqual({ kind: "other", label: "Other color…" });
  });

  it("lists the imported profiles by name in file order, keyed by position", () => {
    const rows = levelRows({ kind: "import" }, sources, none);
    expect(rows.map((r) => [r.label, r.kind === "color" ? r.key : ""])).toEqual([
      ["Mine PLA Teal", "import:0"],
      ["Mine PLA Gold", "import:1"],
    ]);
  });
});

describe("searchRows", () => {
  it("matches every word of the query in the name, in any order and case", () => {
    expect(searchRows(sources, "red acme").map((r) => r.label)).toEqual(["Acme PLA Red"]);
    expect(searchRows(sources, "pla").map((r) => r.label)).toEqual([
      "Acme PLA Red",
      "Acme PLA Blue",
      "Acme PLA Black",
      "Sunlu PLA White",
    ]);
  });

  it("lists the whole catalog for an empty query", () => {
    expect(searchRows(sources, "  ")).toHaveLength(5);
  });
});

describe("selectedEntries", () => {
  it("gives imported profiles first in file order, then the catalog's in its order", () => {
    const selected = new Set([dbKey(PROFILES[3]!), importKey(1), dbKey(PROFILES[0]!), "db:gone"]);
    expect(selectedEntries(sources, selected).map((e) => e.profile.name)).toEqual([
      "Mine PLA Gold",
      "Acme PLA Red",
      "Acme PETG Clear",
    ]);
  });
});

describe("trayText", () => {
  it("is empty with nothing ticked", () => {
    expect(trayText([])).toBe("");
  });

  it("counts what's ticked by brand and material", () => {
    const entries = selectedEntries(
      sources,
      new Set([dbKey(PROFILES[0]!), dbKey(PROFILES[1]!), dbKey(PROFILES[4]!)]),
    );
    expect(trayText(entries)).toBe("3 ticked: Acme PLA ×2 · Sunlu PLA");
  });
});

describe("findDetail", () => {
  const ready = values({
    printerPreset: "Bambu Lab X1 Carbon 0.4 nozzle, Bambu Lab X1 Carbon 0.6 nozzle",
    skipSpoolease: false,
    host: "10.0.0.5",
    securityKey: "SECRET",
  });

  it("shows a source's brand count", () => {
    expect(
      findDetail(null, levelRows({ kind: "root" }, sources, none)[0], sources, none, ready),
    ).toEqual({ kind: "source", title: "SpoolmanDB", lines: ["5 filaments from 2 brands"] });
  });

  it("shows a brand's materials with counts", () => {
    const row = levelRows({ kind: "brands" }, sources, none)[0];
    expect(findDetail(null, row, sources, none, ready)).toEqual({
      kind: "brand",
      title: "Acme",
      materials: [
        { label: "PETG", count: 1, ticked: 0 },
        { label: "PLA", count: 3, ticked: 0 },
      ],
    });
  });

  it("shows a material's colors", () => {
    const level = { kind: "materials", brand: "Acme" } as const;
    const row = levelRows(level, sources, none)[1];
    const detail = findDetail(level, row, sources, none, ready);
    expect(detail).toMatchObject({ kind: "material", title: "Acme PLA" });
    expect(detail?.kind === "material" && detail.colors.map((p) => p.colorName)).toEqual([
      "Black",
      "Blue",
      "Red",
    ]);
  });

  it("shows a color's facts and what saving it adds, never the security key", () => {
    const row = levelRows({ kind: "colors", brand: "Acme", material: "PLA" }, sources, none)[2];
    const detail = findDetail(null, row, sources, new Set(["db:PACMRED0"]), ready);
    expect(detail).toEqual({
      kind: "color",
      title: "Acme PLA Red",
      swatch: "#FF0000",
      ticked: true,
      facts: [
        { label: "Brand", value: "Acme" },
        { label: "Material", value: "PLA" },
        { label: "Color", value: "Red · #FF0000" },
        { label: "Nozzle", value: "200–220°C" },
        { label: "Filament", value: "1000 g" },
        { label: "Empty spool", value: "200 g" },
        { label: "Density", value: "1.24 g/cm³" },
        { label: "Diameter", value: "1.75 mm" },
        { label: "Code", value: "PACMRED0", dim: true },
      ],
      adds: [
        "BambuStudio preset for X1C 0.4",
        "BambuStudio preset for X1C 0.6",
        "SpoolEase custom filament PACMRED0",
        "A SpoolEase spool",
      ],
      addsShort: "preset ×2 · custom filament · spool",
    });
    expect(JSON.stringify(detail)).not.toContain("SECRET");
  });

  it("says unknown weights and leaves SpoolEase out when it's skipped or spools aren't created", () => {
    const bare = profile({ labelWeight: 0, coreWeight: 0, slicerFilamentCode: "GFL99" });
    const s: Sources = { db: [bare], imported: [], importName: null };
    const row = searchRows(s, "")[0];
    const skipped = findDetail(null, row, s, none, values());
    expect(skipped?.kind === "color" && skipped.facts).toContainEqual({
      label: "Empty spool",
      value: "unknown",
    });
    expect(skipped?.kind === "color" && skipped.facts).toContainEqual({
      label: "Slicer code",
      value: "GFL99",
      dim: true,
    });
    expect(skipped?.kind === "color" && skipped.adds).toEqual(["BambuStudio preset for X1C 0.4"]);
    expect(skipped?.kind === "color" && skipped.addsShort).toBe("preset ×1");
    const noSpools = findDetail(null, row, s, none, { ...ready, createSpools: false });
    expect(noSpools?.kind === "color" && noSpools.adds.at(-1)).toBe(
      "SpoolEase custom filament PACMRED0".replace("PACMRED0", bare.filamentId),
    );
  });

  it("explains Other color…", () => {
    const level = { kind: "colors", brand: "Acme", material: "PLA" } as const;
    const rows = levelRows(level, sources, none);
    expect(findDetail(level, rows.at(-1), sources, none, ready)).toEqual({
      kind: "other",
      title: "Other color…",
      lines: [
        "A color SpoolmanDB doesn't list for Acme PLA.",
        "It takes the settings of a listed color you choose, with its own name and hex.",
      ],
    });
  });

  it("is null without a row", () => {
    expect(findDetail(null, undefined, sources, none, ready)).toBeNull();
  });
});
