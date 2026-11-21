// ABOUTME: The Add tab's catalog views: drill-down levels (sources, brands, materials, colors), search and selection.
// ABOUTME: Also the tray line and the detail panel's data for the highlighted row; all pure.

import { basename } from "node:path";

import type { FilamentProfile } from "../../../models.js";
import { filterProfiles, SPOOLMANDB_SOURCE } from "../../../spoolmanDb.js";
import type { FormValues } from "../../core/values.js";
import { consoleSetup, printersOf } from "./targets.js";

export const SPOOLMANDB_LABEL = "SpoolmanDB";
export const OTHER_COLOR = "Other color…";

/** What Find lists: SpoolmanDB (with the session's own colors) and the profiles of an imported file or URL. */
export interface Sources {
  db: FilamentProfile[];
  imported: FilamentProfile[];
  /** The import's file name; null without an import source. */
  importName: string | null;
}

/** Selection keys: catalog profiles by filament ID, imported ones by position (a file can repeat an ID). */
export function dbKey(profile: FilamentProfile): string {
  return `db:${profile.filamentId}`;
}

export function importKey(index: number): string {
  return `import:${index}`;
}

/** The settings' source when it's a file or URL to import, else null. */
export function importSourceOf(values: FormValues): string | null {
  const source = values.source.trim();
  return source && source !== SPOOLMANDB_SOURCE ? source : null;
}

export function importName(source: string): string {
  return /^https?:\/\//i.test(source) ? source : basename(source);
}

export function tempsText(low: number, high: number): string {
  return low === high ? `${low}°C` : `${low}–${high}°C`;
}

export function swatchOf(profile: FilamentProfile): string {
  return `#${profile.colorRgba.slice(0, 6)}`;
}

export type Level =
  | { kind: "root" }
  | { kind: "brands" }
  | { kind: "materials"; brand: string }
  | { kind: "colors"; brand: string; material: string }
  | { kind: "import" };

export type FindRow =
  | { kind: "source"; source: "db" | "import"; label: string; count: number; ticked: number }
  | { kind: "brand"; label: string; count: number; ticked: number }
  | { kind: "material"; label: string; count: number; ticked: number }
  | { kind: "color"; label: string; key: string; profile: FilamentProfile }
  /** Last on every color list: a color the catalog doesn't list. */
  | { kind: "other"; label: string };

export interface Entry {
  key: string;
  profile: FilamentProfile;
  origin: "db" | "import";
}

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

function dbEntries(sources: Sources): Entry[] {
  return sources.db.map((profile) => ({ key: dbKey(profile), profile, origin: "db" as const }));
}

function importEntries(sources: Sources): Entry[] {
  return sources.imported.map((profile, index) => ({
    key: importKey(index),
    profile,
    origin: "import" as const,
  }));
}

/** Distinct values of pick, sorted, with how many entries and ticked entries have each. */
function groups(
  entries: Entry[],
  pick: (p: FilamentProfile) => string,
  selected: ReadonlySet<string>,
) {
  const counts = new Map<string, { count: number; ticked: number }>();
  for (const entry of entries) {
    const label = pick(entry.profile);
    const group = counts.get(label) ?? { count: 0, ticked: 0 };
    group.count += 1;
    if (selected.has(entry.key)) group.ticked += 1;
    counts.set(label, group);
  }
  return [...counts].sort(([a], [b]) => byName(a, b)).map(([label, c]) => ({ label, ...c }));
}

function colorRow(entry: Entry, label: string): FindRow {
  return { kind: "color", label, key: entry.key, profile: entry.profile };
}

function colorLabel(profile: FilamentProfile): string {
  return profile.colorName || profile.name;
}

function ofMaterial(sources: Sources, brand: string, material: string): Entry[] {
  return dbEntries(sources).filter(
    (e) => e.profile.brand === brand && e.profile.material === material,
  );
}

/** The materials a brand has, sorted. */
export function materialsOf(sources: Sources, brand: string): string[] {
  return groups(
    dbEntries(sources).filter((e) => e.profile.brand === brand),
    (p) => p.material,
    new Set(),
  ).map((g) => g.label);
}

export function levelRows(
  level: Level,
  sources: Sources,
  selected: ReadonlySet<string>,
): FindRow[] {
  const ticked = (entries: Entry[]) => entries.filter((e) => selected.has(e.key)).length;
  switch (level.kind) {
    case "root": {
      const db = dbEntries(sources);
      const imported = importEntries(sources);
      return [
        {
          kind: "source",
          source: "db",
          label: SPOOLMANDB_LABEL,
          count: db.length,
          ticked: ticked(db),
        },
        ...(sources.importName === null
          ? []
          : [
              {
                kind: "source" as const,
                source: "import" as const,
                label: sources.importName,
                count: imported.length,
                ticked: ticked(imported),
              },
            ]),
      ];
    }
    case "brands":
      return groups(dbEntries(sources), (p) => p.brand, selected).map((g) => ({
        kind: "brand" as const,
        ...g,
      }));
    case "materials":
      return groups(
        dbEntries(sources).filter((e) => e.profile.brand === level.brand),
        (p) => p.material,
        selected,
      ).map((g) => ({ kind: "material" as const, ...g }));
    case "colors":
      return [
        ...ofMaterial(sources, level.brand, level.material)
          .sort((a, b) => byName(colorLabel(a.profile), colorLabel(b.profile)))
          .map((e) => colorRow(e, colorLabel(e.profile))),
        { kind: "other", label: OTHER_COLOR },
      ];
    case "import":
      return importEntries(sources).map((e) => colorRow(e, e.profile.name));
  }
}

/** Catalog profiles whose names have every word of the query, in catalog order. */
export function searchRows(sources: Sources, query: string): FindRow[] {
  const matches = new Set(filterProfiles(sources.db, { brand: "", material: "", match: query }));
  return dbEntries(sources)
    .filter((e) => matches.has(e.profile))
    .map((e) => colorRow(e, e.profile.name));
}

/** The ticked profiles a run gets: imported ones in file order, then the catalog's in its order. */
export function selectedEntries(sources: Sources, selected: ReadonlySet<string>): Entry[] {
  return [...importEntries(sources), ...dbEntries(sources)].filter((e) => selected.has(e.key));
}

/** "3 ticked: Acme PLA ×2 · Sunlu PLA", or "" when nothing is. */
export function trayText(entries: Entry[]): string {
  if (entries.length === 0) return "";
  const counts = new Map<string, number>();
  for (const { profile } of entries) {
    const label = `${profile.brand} ${profile.material}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label));
  return `${entries.length} ticked: ${parts.join(" · ")}`;
}

export interface Fact {
  label: string;
  value: string;
  dim?: boolean;
}

export type FindDetail =
  | { kind: "source"; title: string; lines: string[] }
  | { kind: "brand"; title: string; materials: { label: string; count: number; ticked: number }[] }
  | { kind: "material"; title: string; colors: FilamentProfile[] }
  | {
      kind: "color";
      title: string;
      swatch: string;
      ticked: boolean;
      facts: Fact[];
      /** What saving it adds, one line per target. */
      adds: string[];
    }
  | { kind: "other"; title: string; lines: string[] };

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function grams(value: number): string {
  return value > 0 ? `${value} g` : "unknown";
}

/** The filament's facts and what a run writes for it with these settings. */
function colorDetail(profile: FilamentProfile, ticked: boolean, values: FormValues): FindDetail {
  const swatch = swatchOf(profile);
  const facts: Fact[] = [
    { label: "Brand", value: profile.brand },
    { label: "Material", value: profile.material },
    { label: "Color", value: `${profile.colorName} · ${swatch.toUpperCase()}` },
    { label: "Nozzle", value: tempsText(profile.nozzleTempMin, profile.nozzleTempMax) },
    { label: "Filament", value: grams(profile.labelWeight) },
    { label: "Empty spool", value: grams(profile.coreWeight) },
    { label: "Density", value: `${profile.density} g/cm³` },
    { label: "Diameter", value: `${profile.diameter} mm` },
    { label: "Code", value: profile.filamentId, dim: true },
    ...(profile.slicerFilamentCode
      ? [{ label: "Slicer code", value: profile.slicerFilamentCode, dim: true }]
      : []),
  ];
  const ready = consoleSetup(values) === "ready";
  const adds = [
    ...printersOf(values).map(
      (printer) => `BambuStudio preset for ${printer.replace(/^Bambu Lab /, "")}`,
    ),
    ...(ready ? [`SpoolEase custom filament ${profile.filamentId}`] : []),
    ...(ready && values.createSpools ? ["SpoolEase spool of it"] : []),
  ];
  return { kind: "color", title: profile.name, swatch, ticked, facts, adds };
}

/**
 * What the detail panel shows for the highlighted row of a level (null for search results, which are
 * all colors); null when nothing is highlighted.
 */
export function findDetail(
  level: Level | null,
  row: FindRow | undefined,
  sources: Sources,
  selected: ReadonlySet<string>,
  values: FormValues,
): FindDetail | null {
  if (!row) return null;
  switch (row.kind) {
    case "source": {
      if (row.source === "import")
        return {
          kind: "source",
          title: row.label,
          lines: [`${plural(row.count, "filament")} to import`],
        };
      const brands = new Set(sources.db.map((p) => p.brand)).size;
      return {
        kind: "source",
        title: row.label,
        lines: [`${plural(row.count, "filament")} from ${plural(brands, "brand")}`],
      };
    }
    case "brand":
      return {
        kind: "brand",
        title: row.label,
        materials: levelRows({ kind: "materials", brand: row.label }, sources, selected).flatMap(
          (r) =>
            r.kind === "material" ? [{ label: r.label, count: r.count, ticked: r.ticked }] : [],
        ),
      };
    case "material": {
      const brand = level?.kind === "materials" ? level.brand : "";
      return {
        kind: "material",
        title: `${brand} ${row.label}`.trim(),
        colors: ofMaterial(sources, brand, row.label)
          .map((e) => e.profile)
          .sort((a, b) => byName(colorLabel(a), colorLabel(b))),
      };
    }
    case "color":
      return colorDetail(row.profile, selected.has(row.key), values);
    case "other": {
      const what = level?.kind === "colors" ? ` for ${level.brand} ${level.material}` : "";
      return {
        kind: "other",
        title: OTHER_COLOR,
        lines: [
          `A color SpoolmanDB doesn't list${what}.`,
          "It takes the settings of a listed color you choose, with its own name and hex.",
        ],
      };
    }
  }
}
