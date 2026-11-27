// ABOUTME: Reads filament-db's JSON export (docs/export.md in filament-db): manufacturer presets and material settings
// ABOUTME: per product line, found by 3DFP or SpoolmanDB id, and 3DFP records. No file means no export, silently.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix } from "node:path";

import type { PrinterModel } from "./bambuProfiles.js";
import { errorMessage } from "./errors.js";
import { filamentDetail, type TdfpFilamentDetail } from "./filamentProfiles.js";
import type { FilamentProfile } from "./models.js";

/** The export's version bambu-hando reads; any other is treated as no export. */
export const EXPORT_SCHEMA_VERSION = 2;

/** A value as the export wraps it: how far to trust it (`tier`), where it came from, and `suspect` when it shouldn't be. */
export interface ExportValue {
  value: unknown;
  tier: string;
  source: string;
  url: string | null;
  suspect?: string;
}

export type ExportValues = Record<string, ExportValue>;

/** One manufacturer preset for a printer and nozzle; `settings` is a whole preset ready to write, identity keys left out. */
export interface ManufacturerPreset {
  printer: string;
  nozzleMm: number;
  /** Printers without a preset of their own from this source that take this one (the X1, X1 Carbon and P1S). */
  fillsInFor: string[];
  extruderVariants: string[];
  source: string;
  url: string | null;
  settings: ExportValues;
}

export interface FilamentLine {
  id: number;
  brand: string;
  material: string;
  name: string;
  properties: ExportValues;
  /** Slicer keys a manufacturer source sets alike on every printer of the line. */
  materialSettings: ExportValues;
  presets: ManufacturerPreset[];
}

/** A line found for a filament, with its properties as its color has them (a color's value overrides its line's). */
export interface LineMatch {
  line: FilamentLine;
  properties: ExportValues;
}

export interface ExportRecord {
  record: TdfpFilamentDetail;
  fetchedAt: Date;
}

/** The ids a profile's source knows it by, which is how its line is found (never by name). */
export interface SourceIds {
  /** 3DFilamentProfiles filament id. */
  tdfp?: number;
  /** SpoolmanDB entry id. */
  spoolmanDb?: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const objects = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function values(raw: unknown): ExportValues {
  const result: ExportValues = {};
  if (!isObject(raw)) return result;
  for (const [key, item] of Object.entries(raw)) {
    if (!isObject(item) || !("value" in item)) continue;
    result[key] = {
      value: item.value,
      tier: text(item.tier),
      source: text(item.source),
      url: typeof item.url === "string" ? item.url : null,
      ...(typeof item.suspect === "string" ? { suspect: item.suspect } : {}),
    };
  }
  return result;
}

function preset(raw: Json): ManufacturerPreset | null {
  const nozzleMm = numberOf(raw.nozzle_mm);
  if (!text(raw.printer) || nozzleMm === null) return null;
  return {
    printer: text(raw.printer),
    nozzleMm,
    fillsInFor: texts(raw.fills_in_for),
    extruderVariants: texts(raw.extruder_variants),
    source: text(raw.source),
    url: typeof raw.url === "string" ? raw.url : null,
    settings: values(raw.settings),
  };
}

const sameNozzle = (a: number, b: number) => Math.abs(a - b) < 0.001;

/** The line's preset for a printer and nozzle: its own, else one that fills in for that printer. */
export function presetFor(
  line: FilamentLine,
  printer: { model: string; nozzleMm: number },
): ManufacturerPreset | null {
  const sized = line.presets.filter((p) => sameNozzle(p.nozzleMm, printer.nozzleMm));
  return (
    sized.find((p) => p.printer === printer.model) ??
    sized.find((p) => p.fillsInFor.includes(printer.model)) ??
    null
  );
}

/**
 * Tiers that are a manufacturer's word (or Max's, entered by hand): not `manufacturer_inherited` (Generic's value
 * inside a manufacturer preset, no evidence) nor `community`.
 */
const MANUFACTURER_TIERS = new Set(["manufacturer_preset", "manufacturer_tds", "manual"]);

export function isManufacturerValue(value: ExportValue | undefined): value is ExportValue {
  return value !== undefined && MANUFACTURER_TIERS.has(value.tier) && value.suspect === undefined;
}

/** What filament-db's export has for one printer file of a filament: its line, and the preset for that printer if any. */
export interface Manufacturer {
  match: LineMatch;
  preset: ManufacturerPreset | null;
}

/** The filament's line (by its source's ids) and its preset for the printer; null without a line. */
export function manufacturerFor(
  db: FilamentDb | null,
  ids: SourceIds | undefined,
  printer: PrinterModel | null,
): Manufacturer | null {
  const match = db?.lineFor(ids) ?? null;
  if (!match) return null;
  return { match, preset: printer ? presetFor(match.line, printer) : null };
}

/** The manufacturer's printing temperature range for a line; null when its range is only community data. */
export function manufacturerRange(match: LineMatch | null): { low: number; high: number } | null {
  const low = match?.properties.nozzle_min_c;
  const high = match?.properties.nozzle_max_c;
  if (!isManufacturerValue(low) || !isManufacturerValue(high)) return null;
  return typeof low.value === "number" && typeof high.value === "number"
    ? { low: low.value, high: high.value }
    : null;
}

/**
 * The profile with its line's manufacturer range in place of its source's, widened for the user's own calibrated
 * temperature as an import widens it; the profile as it is when the line has no manufacturer range.
 */
export function withManufacturerRange(
  profile: FilamentProfile,
  match: LineMatch | null,
): FilamentProfile {
  const range = manufacturerRange(match);
  if (!range) return profile;
  const own = profile.calibration?.printTemp;
  const low = own === undefined ? range.low : Math.min(range.low, Math.round(own));
  const high = own === undefined ? range.high : Math.max(range.high, Math.round(own));
  return { ...profile, nozzleTempMin: low, nozzleTempMax: high };
}

interface Filed {
  lineId: number;
  colorId: number | null;
}

export class FilamentDb {
  private constructor(
    private readonly lines: Map<number, FilamentLine>,
    /** Each color's own properties, by color id. */
    private readonly colorProperties: Map<number, ExportValues>,
    private readonly tdfp: Map<number, Filed>,
    private readonly records: Map<number, ExportRecord>,
    private readonly aliases: Map<number, number>,
    private readonly spoolmanDb: Map<string, Filed>,
  ) {}

  /** Keeps only what bambu-hando uses; unknown fields are ignored. Throws on another schema_version. */
  static parse(doc: unknown): FilamentDb {
    if (!isObject(doc)) throw new Error("not a JSON object");
    if (doc.schema_version !== EXPORT_SCHEMA_VERSION)
      throw new SchemaError(String(doc.schema_version));
    const lines = new Map<number, FilamentLine>();
    const colorProperties = new Map<number, ExportValues>();
    const tdfp = new Map<number, Filed>();
    const spoolmanDb = new Map<string, Filed>();
    for (const raw of objects(doc.lines)) {
      const id = numberOf(raw.id);
      if (id === null) continue;
      lines.set(id, {
        id,
        brand: text(raw.brand),
        material: text(raw.material),
        name: text(raw.name),
        properties: values(raw.properties),
        materialSettings: values(raw.material_settings),
        presets: objects(raw.printer_presets)
          .map(preset)
          .filter((p): p is ManufacturerPreset => p !== null),
      });
      for (const color of objects(raw.colors)) {
        const colorId = numberOf(color.id);
        if (colorId !== null) colorProperties.set(colorId, values(color.properties));
        for (const entry of texts(color.spoolmandb_ids))
          spoolmanDb.set(entry, { lineId: id, colorId });
        if (Array.isArray(color.tdfp_ids))
          for (const filament of color.tdfp_ids)
            if (typeof filament === "number") tdfp.set(filament, { lineId: id, colorId });
      }
    }
    const records = new Map<number, ExportRecord>();
    if (isObject(doc.tdfp))
      for (const [key, entry] of Object.entries(doc.tdfp)) {
        const id = Number(key);
        const lineId = isObject(entry) ? numberOf(entry.line_id) : null;
        if (!Number.isInteger(id) || !isObject(entry) || lineId === null) continue;
        tdfp.set(id, { lineId, colorId: numberOf(entry.color_id) });
        const fetchedAt = new Date(text(entry.fetched_at));
        if (isObject(entry.record) && Number.isFinite(fetchedAt.getTime()))
          records.set(id, {
            record: filamentDetail({
              id,
              ...(isObject(entry.summary) ? entry.summary : {}),
              ...entry.record,
            }),
            fetchedAt,
          });
      }
    const aliases = new Map<number, number>();
    if (isObject(doc.tdfp_aliases))
      for (const [key, survivor] of Object.entries(doc.tdfp_aliases))
        if (Number.isInteger(Number(key)) && typeof survivor === "number")
          aliases.set(Number(key), survivor);
    return new FilamentDb(lines, colorProperties, tdfp, records, aliases, spoolmanDb);
  }

  private match(filed: Filed | undefined): LineMatch | null {
    const line = filed && this.lines.get(filed.lineId);
    if (!line) return null;
    const color = filed.colorId === null ? undefined : this.colorProperties.get(filed.colorId);
    return { line, properties: { ...line.properties, ...color } };
  }

  /** A merged 3DFP id is looked up as the id that survived. */
  private tdfpId(id: number): number {
    return this.tdfp.has(id) ? id : (this.aliases.get(id) ?? id);
  }

  lineForTdfp(id: number): LineMatch | null {
    return this.match(this.tdfp.get(this.tdfpId(id)));
  }

  lineForSpoolmanDb(id: string): LineMatch | null {
    return this.match(this.spoolmanDb.get(id));
  }

  /** A profile's line by its 3DFP id first, then its SpoolmanDB id. */
  lineFor(ids: SourceIds | undefined): LineMatch | null {
    if (ids?.tdfp !== undefined) {
      const found = this.lineForTdfp(ids.tdfp);
      if (found) return found;
    }
    return ids?.spoolmanDb === undefined ? null : this.lineForSpoolmanDb(ids.spoolmanDb);
  }

  /** The 3DFP record filament-db's cache holds for a filament; null when it knows it only from a search. */
  tdfpRecord(id: number): ExportRecord | null {
    return this.records.get(this.tdfpId(id)) ?? null;
  }
}

class SchemaError extends Error {
  constructor(readonly version: string) {
    super(`schema_version ${version}`);
  }
}

/** FILAMENT_DB_EXPORT, else filament-db's own default: $XDG_DATA_HOME or ~/.local/share, on every OS (its paths.py). */
export function filamentDbPath(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  if (env.FILAMENT_DB_EXPORT) return env.FILAMENT_DB_EXPORT;
  const data = env.XDG_DATA_HOME || posix.join(home, ".local", "share");
  return posix.join(data, "filament-db", "export", "catalog.json");
}

export interface FilamentDbLoad {
  db: FilamentDb | null;
  /** Why an export that's there isn't used; null when it is, or when there's none. */
  warning: string | null;
}

const loads = new Map<string, Promise<FilamentDbLoad>>();

async function load(path: string): Promise<FilamentDbLoad> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { db: null, warning: null };
    return {
      db: null,
      warning: `couldn't read filament-db's export ${path}: ${errorMessage(err)}`,
    };
  }
  try {
    return { db: FilamentDb.parse(JSON.parse(raw)), warning: null };
  } catch (err) {
    if (err instanceof SchemaError)
      return {
        db: null,
        warning: `filament-db's export ${path} has schema_version ${err.version}, not ${EXPORT_SCHEMA_VERSION}: bambu-hando ignores it`,
      };
    return {
      db: null,
      warning: `couldn't read filament-db's export ${path}: ${errorMessage(err)}`,
    };
  }
}

/** The export at path, parsed once per run (the file is about 40 MB). */
export function loadFilamentDb(path: string = filamentDbPath()): Promise<FilamentDbLoad> {
  let loaded = loads.get(path);
  if (!loaded) {
    loaded = load(path);
    loads.set(path, loaded);
  }
  return loaded;
}
