// ABOUTME: Profile source ingestion from URL/local JSON into normalized records.
// ABOUTME: Supports a lightweight schema so users can bulk-import filament catalogs.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { normalizeRgba } from "./colors.js";
import type { FilamentProfile } from "./models.js";

const FETCH_TIMEOUT_MS = 20_000;

async function readText(source: string): Promise<string> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const resp = await fetch(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!resp.ok) throw new Error(`Failed to download ${source}: HTTP ${resp.status}`);
    return resp.text();
  }
  return readFile(source, "utf-8");
}

function text(value: unknown, fallback: string): string {
  return value === undefined || value === null ? fallback : String(value).trim();
}

// Same scheme BambuStudio uses for user filaments ("P" + 7 hex of md5 of the name, CreatePresetsDialog.cpp),
// so IDs are stable across runs and source reordering. BambuStudio also mixes in the cloud user id when
// logged in; we can't know it, and don't need to, because our presets carry filament_id explicitly.
function derivedFilamentId(name: string): string {
  return `P${createHash("md5").update(name, "utf-8").digest("hex").slice(0, 7)}`;
}

function integer(value: unknown, fallback: number, field: string, idx: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
  throw new Error(`Profile entry at index ${idx} has invalid ${field}: ${JSON.stringify(value)}`);
}

function decimal(value: unknown, fallback: number, field: string, idx: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || String(value).trim() === "") {
    throw new Error(`Profile entry at index ${idx} has invalid ${field}: ${JSON.stringify(value)}`);
  }
  return parsed;
}

/**
 * Load profiles from a JSON list or an object with a `profiles` key.
 *
 * Supported item keys: name, brand, material, color_name, color_rgba|color_hex,
 * nozzle_temp_min, nozzle_temp_max, density, diameter, slicer_filament_code.
 */
export async function loadProfiles(source: string): Promise<FilamentProfile[]> {
  const payload: unknown = JSON.parse(await readText(source));

  let items: unknown[];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (typeof payload === "object" && payload !== null) {
    const profiles = (payload as Record<string, unknown>).profiles;
    items = Array.isArray(profiles) ? profiles : [];
  } else {
    throw new Error("Unsupported profile source shape: expected JSON list or object");
  }

  return items.map((item, idx) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`Profile entry at index ${idx} is not an object`);
    }
    const entry = item as Record<string, unknown>;

    const name = text(entry.name, "");
    if (!name) throw new Error(`Profile entry at index ${idx} is missing name`);

    const colorName = text(entry.color_name, "Unknown") || "Unknown";
    const colorValue = entry.color_rgba || entry.color_hex;
    const slicerFilamentCode = text(entry.slicer_filament_code, "");

    return {
      name,
      brand: text(entry.brand, "Generic") || "Generic",
      material: text(entry.material, "PLA").toUpperCase() || "PLA",
      colorName,
      colorRgba: normalizeRgba(colorName, typeof colorValue === "string" ? colorValue : null),
      nozzleTempMin: integer(entry.nozzle_temp_min, 190, "nozzle_temp_min", idx),
      nozzleTempMax: integer(entry.nozzle_temp_max, 240, "nozzle_temp_max", idx),
      density: decimal(entry.density, 1.24, "density", idx),
      diameter: decimal(entry.diameter, 1.75, "diameter", idx),
      slicerFilamentCode,
      filamentId: slicerFilamentCode || derivedFilamentId(name),
    };
  });
}
