// ABOUTME: BambuStudio custom filament preset writer for Linux and macOS.
// ABOUTME: Clones a Generic system preset like BambuStudio's "Create filament"; keeps existing presets unless told to overwrite.

import { access } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./atomicWrite.js";
import type { PresetConfig, SystemProfiles, Template } from "./bambuProfiles.js";
import { rgbaToHashRgb } from "./colors.js";
import { errorMessage } from "./errors.js";
import {
  type FilamentDb,
  isManufacturerValue,
  type Manufacturer,
  manufacturerFor,
  withManufacturerRange,
} from "./filamentDb.js";
import type { FilamentProfile } from "./models.js";
import { bambuBaseFilamentDir } from "./paths.js";
import { applySettings, layered, withoutKeys } from "./presetSettings.js";

// Keys that describe the system preset itself rather than filament settings.
const SYSTEM_ONLY_KEYS = [
  "type",
  "setting_id",
  "instantiation",
  "description",
  "inherits",
  "name",
  "from",
  "filament_id",
];

/** BambuStudio names custom filaments "<name> @<printer>" and replaces "/" (CreatePresetsDialog / clone_presets). */
export function presetName(profile: FilamentProfile, printer: string): string {
  return `${profile.name.replaceAll("/", "-")} @${printer}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Per-extruder-variant arrays: replace every real entry, keep "nil" (= use the printer's value).
function everyVariant(value: unknown, replacement: (current: string) => string): unknown {
  if (!Array.isArray(value) || value.length === 0) return [replacement("")];
  return value.map((entry) => (entry === "nil" ? entry : replacement(String(entry))));
}

/**
 * Keys a manufacturer's values never set: bambu-hando's own identity for the preset, and the spool's (its vendor,
 * color and diameter come from the filament's source).
 */
const IDENTITY_KEYS = new Set([
  ...SYSTEM_ONLY_KEYS,
  "compatible_printers",
  "compatible_printers_condition",
  "filament_settings_id",
  "version",
  "filament_vendor",
  "filament_colour",
  "default_filament_colour",
  "filament_diameter",
  "filament_notes",
]);

/** Slicer keys a line's manufacturer properties give when its material settings don't (units as the export's). */
const PROPERTY_KEYS: [property: string, key: string][] = [
  ["density_g_cm3", "filament_density"],
  ["nozzle_min_c", "nozzle_temperature_range_low"],
  ["nozzle_max_c", "nozzle_temperature_range_high"],
  ["softening_c", "temperature_vitrification"],
];

interface MakerValues {
  /** What goes over the template. */
  values: PresetConfig;
  /** Keys the manufacturer covers, so community values leave them alone (suspect ones included). */
  covered: Set<string>;
}

/**
 * A manufacturer preset for the printer: all of it, but suspect values (the template's stay). Without one, the
 * line's manufacturer-tier material settings (and properties where those don't give a key).
 */
function makerValues(manufacturer: Manufacturer | null): MakerValues {
  const result: MakerValues = { values: {}, covered: new Set() };
  if (!manufacturer) return result;
  const { preset, match } = manufacturer;
  if (preset) {
    for (const [key, value] of Object.entries(preset.settings)) {
      if (IDENTITY_KEYS.has(key)) continue;
      result.covered.add(key);
      if (value.suspect === undefined) result.values[key] = value.value;
    }
    return result;
  }
  for (const [key, value] of Object.entries(match.line.materialSettings))
    if (!IDENTITY_KEYS.has(key) && isManufacturerValue(value)) {
      result.covered.add(key);
      result.values[key] = value.value;
    }
  for (const [property, key] of PROPERTY_KEYS) {
    const value = match.properties[property];
    if (result.covered.has(key) || !isManufacturerValue(value) || typeof value.value !== "number")
      continue;
    result.covered.add(key);
    result.values[key] = [String(value.value)];
  }
  return result;
}

function firstNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(Array.isArray(value) ? value[0] : value));
  return Number.isFinite(parsed) ? parsed : null;
}

function rangeOf(
  profile: FilamentProfile,
  manufacturer: Manufacturer | null,
  maker: MakerValues,
): { low: number; high: number } {
  const own = manufacturer ? withManufacturerRange(profile, manufacturer.match) : profile;
  // The manufacturer's values give the range when they have one (a preset's own, Generic's included), else the line's
  // manufacturer range, else the source's; widened only for the user's own calibrated temperature.
  let low = firstNumber(maker.values.nozzle_temperature_range_low) ?? own.nozzleTempMin;
  let high = firstNumber(maker.values.nozzle_temperature_range_high) ?? own.nozzleTempMax;
  const calibrated = profile.calibration?.printTemp;
  if (calibrated !== undefined) {
    low = Math.min(low, Math.round(calibrated));
    high = Math.max(high, Math.round(calibrated));
  }
  return { low, high };
}

/**
 * The nozzle range buildPreset writes into the profile's preset for a printer (before plan edits), which SpoolEase's
 * custom filament row follows.
 */
export function presetRange(
  profile: FilamentProfile,
  manufacturer: Manufacturer | null,
): { low: number; high: number } {
  return rangeOf(profile, manufacturer, makerValues(manufacturer));
}

/** The profile with the nozzle range its preset for the printer is written with (the first printer's, for SpoolEase). */
export function plannedRange(
  profile: FilamentProfile,
  db: FilamentDb | null,
  system: SystemProfiles | null,
  printer: string | undefined,
): FilamentProfile {
  const model = system && printer !== undefined ? system.printerModel(printer) : null;
  const range = presetRange(profile, manufacturerFor(db, profile.sourceIds, model));
  return { ...profile, nozzleTempMin: range.low, nozzleTempMax: range.high };
}

function makerNote(manufacturer: Manufacturer | null): string {
  if (!manufacturer) return "";
  const { preset, match } = manufacturer;
  return preset
    ? ` with ${match.line.brand}'s preset for the ${preset.printer}, ${preset.nozzleMm} mm nozzle (filament-db: ${preset.source})`
    : ` with ${match.line.brand}'s material settings (filament-db)`;
}

/**
 * A custom filament preset for one printer: the template's full settings with this filament's identity,
 * color, density, temperature range and whatever print settings its source has. Like BambuStudio's own custom filaments it inherits nothing
 * and carries its own filament_id, which is what links it to SpoolEase.
 *
 * With filament-db's manufacturer data for its line, lowest first: the template; the manufacturer's preset for the
 * printer (else the line's material settings); the source's community values only where no manufacturer value is;
 * the user's own calibration on top.
 */
export function buildPreset(
  profile: FilamentProfile,
  printer: string,
  template: Template,
  version: string,
  manufacturer: Manufacturer | null = null,
): PresetConfig {
  const name = presetName(profile, printer);
  const preset: PresetConfig = { ...template.config };
  for (const key of SYSTEM_ONLY_KEYS) delete preset[key];
  const maker = makerValues(manufacturer);
  Object.assign(preset, maker.values);
  const { low, high } = rangeOf(profile, manufacturer, maker);

  // Keep Bambu's tuned print temperature unless the manufacturer's range excludes it.
  const nozzle = (current: string) => {
    const tuned = Number.parseInt(current, 10);
    return String(Number.isFinite(tuned) ? clamp(tuned, low, high) : high);
  };

  const built: PresetConfig = {
    ...preset,
    name,
    from: "User",
    inherits: "",
    version,
    filament_id: profile.filamentId,
    filament_settings_id: [name],
    filament_vendor: [profile.brand],
    compatible_printers: [printer],
    compatible_printers_condition: "",
    default_filament_colour: [rgbaToHashRgb(profile.colorRgba)],
    filament_density: maker.covered.has("filament_density")
      ? preset.filament_density
      : [String(profile.density)],
    filament_diameter: [String(profile.diameter)],
    nozzle_temperature_range_low: [String(low)],
    nozzle_temperature_range_high: [String(high)],
    nozzle_temperature: everyVariant(preset.nozzle_temperature, nozzle),
    nozzle_temperature_initial_layer: everyVariant(preset.nozzle_temperature_initial_layer, nozzle),
    filament_notes: `Generated by bambu-hando from BambuStudio's ${template.name} preset${makerNote(manufacturer)}.`,
  };
  // The source's own print settings win over the template's; the template fills in only what it leaves out.
  // With a manufacturer, they fill in only what the manufacturer leaves out, and the user's calibration goes on top.
  // ...inside the range the preset states, which SpoolEase's CSV row follows (the first printer's preset).
  const settings = manufacturer
    ? layered(profile.calibration ?? {}, withoutKeys(profile.settings ?? {}, maker.covered))
    : (profile.settings ?? {});
  const printTemp =
    settings.printTemp === undefined ? undefined : clamp(settings.printTemp, low, high);
  return applySettings(built, printTemp === undefined ? settings : { ...settings, printTemp });
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]),
  );
}

/** BambuStudio's own layout: sorted keys, 4-space indent, raw UTF-8. */
export function presetJson(preset: PresetConfig): string {
  return `${JSON.stringify(sortedKeys(preset), null, 4)}\n`;
}

/** BambuStudio loads a user preset by file name, so the file is named exactly after the preset. */
export function presetPath(
  profile: FilamentProfile,
  presetFolder: string,
  printer: string,
): string {
  return join(bambuBaseFilamentDir(presetFolder), `${presetName(profile, printer)}.json`);
}

export interface PresetTarget {
  presetFolder: string;
  printers: string[];
  system: SystemProfiles;
  /** filament-db's export: manufacturer presets for the profiles' lines; null or left out for none. */
  filamentDb?: FilamentDb | null;
}

export interface PresetOutcome {
  /** One preset per printer. */
  paths: string[];
  /** Presets that already existed and were left as they are (or would be, in dry-run). */
  kept: string[];
  /** Empty when every preset was written (or planned, in dry-run). */
  error: string;
}

export interface WriteOptions {
  /** Plan only: nothing is written. */
  dryRun?: boolean;
  /** Replace presets that already exist. Off by default, so tuning done in BambuStudio survives re-runs. */
  overwrite?: boolean;
  /** Changes a preset about to be written (not a kept one), e.g. with edits made on the plan. */
  adjust?: (profile: FilamentProfile, printer: string, preset: PresetConfig) => PresetConfig;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Write each profile's presets, one per printer, returning the paths, kept paths and error message (or "") per profile. */
export async function writeMany(
  profiles: FilamentProfile[],
  target: PresetTarget,
  { dryRun = false, overwrite = false, adjust }: WriteOptions = {},
  onOutcome: (index: number, outcome: PresetOutcome) => void = () => {},
): Promise<PresetOutcome[]> {
  const outcomes: PresetOutcome[] = [];
  for (const [index, profile] of profiles.entries()) {
    const paths = target.printers.map((printer) =>
      presetPath(profile, target.presetFolder, printer),
    );
    const kept: string[] = [];
    let error = "";
    try {
      const presets = target.printers.map((printer) => {
        const template = target.system.template(profile.material, printer);
        if (!template)
          throw new Error(`no Generic ${profile.material} preset in BambuStudio for ${printer}`);
        const maker = manufacturerFor(
          target.filamentDb ?? null,
          profile.sourceIds,
          target.system.printerModel(printer),
        );
        return buildPreset(profile, printer, template, target.system.version, maker);
      });
      for (const [i, preset] of presets.entries()) {
        const path = paths[i] ?? "";
        const printer = target.printers[i] ?? "";
        if (!overwrite && (await exists(path))) kept.push(path);
        else {
          const adjusted = adjust ? adjust(profile, printer, preset) : preset;
          if (!dryRun) await writeAtomic(path, presetJson(adjusted));
        }
      }
    } catch (err) {
      error = errorMessage(err);
    }
    const outcome = { paths, kept, error };
    outcomes.push(outcome);
    onOutcome(index, outcome);
  }
  return outcomes;
}
