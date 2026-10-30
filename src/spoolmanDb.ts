// ABOUTME: SpoolmanDB source: downloads the community filament catalog and maps it onto profiles.
// ABOUTME: Caches the compiled JSON files and revalidates them with ETags so runs work offline.

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { normalizeRgba } from "./colors.js";
import { errorMessage } from "./errors.js";
import type { FilamentProfile } from "./models.js";
import { derivedFilamentId } from "./sources.js";

/** --source value that selects SpoolmanDB instead of a file or URL. */
export const SPOOLMANDB_SOURCE = "spoolmandb";
export const SPOOLMANDB_URL = "https://donkie.github.io/SpoolmanDB";

// filaments.json is about 6 MB.
const FETCH_TIMEOUT_MS = 60_000;

// Same fallback as JSON sources when neither the filament nor its material has a temperature.
const DEFAULT_TEMPS = [190, 240] as const;

// BambuStudio ships system presets with their own filament IDs for these; a custom copy would not link to them.
const EXCLUDED_MANUFACTURERS = new Set(["bambu lab"]);

export interface SpoolmanDbOptions {
  baseUrl: string;
  cacheDir: string;
  diameter: number;
}

export interface Catalog {
  profiles: FilamentProfile[];
  /** Non-fatal problems, such as falling back to a cached copy. */
  warnings: string[];
}

export interface ProfileFilters {
  brand: string;
  material: string;
  match: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nozzleTemps(entry: Record<string, unknown>, materialTemp: number | undefined): readonly [number, number] {
  const range = entry.extruder_temp_range;
  if (Array.isArray(range) && range.length === 2) {
    const [low, high] = range.map(num);
    if (low !== null && low !== undefined && high !== null && high !== undefined) return [Math.round(low), Math.round(high)];
  }
  const single = num(entry.extruder_temp) ?? materialTemp ?? null;
  return single === null ? DEFAULT_TEMPS : [Math.round(single), Math.round(single)];
}

function materialTemps(materials: unknown): Map<string, number> {
  const temps = new Map<string, number>();
  if (!Array.isArray(materials)) return temps;
  for (const item of materials) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const temp = num(record.extruder_temp);
    if (str(record.material) && temp !== null) temps.set(str(record.material).toUpperCase(), temp);
  }
  return temps;
}

/**
 * Map SpoolmanDB's compiled filaments.json onto profiles of one diameter.
 *
 * SpoolmanDB lists every weight variant separately; profiles are named "<manufacturer> [material] <name>"
 * (material only when the name lacks it, which keeps names unique across the database), and the first
 * variant of each name wins. Malformed entries are skipped.
 */
export function catalogProfiles(filaments: unknown, materials: unknown, diameter: number): FilamentProfile[] {
  if (!Array.isArray(filaments)) throw new Error("SpoolmanDB filaments.json is not a list");
  const temps = materialTemps(materials);
  const byName = new Map<string, FilamentProfile>();

  for (const item of filaments) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const manufacturer = str(entry.manufacturer);
    const product = str(entry.name);
    const material = str(entry.material).toUpperCase();
    if (!manufacturer || !product || !material || num(entry.diameter) !== diameter) continue;
    if (EXCLUDED_MANUFACTURERS.has(manufacturer.toLowerCase())) continue;

    const name = product.toUpperCase().includes(material) ? `${manufacturer} ${product}` : `${manufacturer} ${material} ${product}`;
    if (byName.has(name)) continue;

    const hexes = entry.color_hexes;
    const hex = str(entry.color_hex) || (Array.isArray(hexes) ? str(hexes[0]) : "");
    const [nozzleTempMin, nozzleTempMax] = nozzleTemps(entry, temps.get(material));
    byName.set(name, {
      name,
      brand: manufacturer,
      material,
      // SpoolmanDB has no separate color name; its product name is what the manufacturer calls the color.
      colorName: product,
      colorRgba: normalizeRgba(product, hex),
      nozzleTempMin,
      nozzleTempMax,
      density: num(entry.density) ?? 1.24,
      diameter,
      slicerFilamentCode: "",
      filamentId: derivedFilamentId(name),
      labelWeight: Math.round(num(entry.weight) ?? 0),
      coreWeight: Math.round(num(entry.spool_weight) ?? 0),
    });
  }
  return [...byName.values()];
}

/** Brand and material match exactly (ignoring case); every --match word must appear in the name. */
export function filterProfiles(profiles: FilamentProfile[], filters: ProfileFilters): FilamentProfile[] {
  const brand = filters.brand.trim().toLowerCase();
  const material = filters.material.trim().toLowerCase();
  const words = filters.match.toLowerCase().split(/\s+/).filter(Boolean);
  return profiles.filter(
    (p) =>
      (!brand || p.brand.toLowerCase() === brand) &&
      (!material || p.material.toLowerCase() === material) &&
      words.every((word) => p.name.toLowerCase().includes(word)),
  );
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Fetch a JSON file, revalidating the cached copy with its ETag. When the download fails and a
 * cached copy exists, return that with a warning instead of failing.
 */
async function fetchCachedJson(url: string, cachePath: string): Promise<{ value: unknown; warning: string }> {
  const etagPath = `${cachePath}.etag`;
  const cached = await readOptional(cachePath);
  const etag = cached === null ? null : await readOptional(etagPath);

  const fallback = async (reason: string): Promise<{ value: unknown; warning: string }> => {
    if (cached === null) throw new Error(`Failed to download ${url}: ${reason}`);
    const day = (await stat(cachePath)).mtime.toISOString().slice(0, 10);
    const file = url.slice(url.lastIndexOf("/") + 1);
    return { value: JSON.parse(cached), warning: `SpoolmanDB ${file} could not be refreshed (${reason}); using the copy cached on ${day}` };
  };

  let resp: Response;
  try {
    resp = await fetch(url, { headers: etag ? { "If-None-Match": etag } : {}, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    return fallback(errorMessage(err));
  }
  if (resp.status === 304 && cached !== null) return { value: JSON.parse(cached), warning: "" };
  if (!resp.ok) return fallback(`HTTP ${resp.status}`);

  const text = await resp.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return fallback(`invalid JSON: ${errorMessage(err)}`);
  }

  await mkdir(join(cachePath, ".."), { recursive: true });
  await writeFile(`${cachePath}.tmp`, text, "utf-8");
  await rename(`${cachePath}.tmp`, cachePath);
  const newEtag = resp.headers.get("etag");
  if (newEtag) await writeFile(etagPath, newEtag, "utf-8");
  else await rm(etagPath, { force: true });
  return { value, warning: "" };
}

/** Download (or reuse the cached) SpoolmanDB catalog and map it onto profiles of one diameter. */
export async function loadSpoolmanDb(options: SpoolmanDbOptions): Promise<Catalog> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetchFile = (file: string) => fetchCachedJson(`${base}/${file}`, join(options.cacheDir, file));
  const [filaments, materials] = await Promise.all([fetchFile("filaments.json"), fetchFile("materials.json")]);
  return {
    profiles: catalogProfiles(filaments.value, materials.value, options.diameter),
    warnings: [filaments.warning, materials.warning].filter(Boolean),
  };
}
