// ABOUTME: Print settings a source gives a filament's presets (print and bed temperature, flow ratio, max volumetric
// ABOUTME: speed, pressure advance), layered by precedence, checked against BambuStudio's bounds and written over the template's.

import type { PresetConfig } from "./bambuProfiles.js";

/**
 * What a source knows about printing a filament. A value left out keeps the Generic template's; precedence between
 * sources is the caller's (`layered`): the user's own calibration, then 3DFP's record, then SpoolmanDB or a JSON file.
 */
export interface PresetSettings {
  /** °C: nozzle_temperature and its first layer. */
  printTemp?: number;
  /** °C: the smooth (high temp), textured PEI and engineering plates, and their first layers. */
  bedTemp?: number;
  flowRatio?: number;
  /** mm³/s. */
  maxVolumetricSpeed?: number;
  /**
   * K, and whether to turn pressure advance on: only for the user's own calibration. BambuStudio ignores both on
   * Bambu printers (GCode.cpp emits M900 only for other printers), so on those it's a record, not a setting.
   */
  pressureAdvance?: { k: number; enabled: boolean };
}

/** The rounded middle of a min–max range, or the one end given. */
export function midpoint(
  min: number | null | undefined,
  max: number | null | undefined,
): number | undefined {
  const ends = [min, max].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (ends.length === 0) return undefined;
  return Math.round(ends.reduce((sum, value) => sum + value, 0) / ends.length);
}

const within = (value: number | undefined, min: number, max: number, open = false) =>
  value !== undefined &&
  Number.isFinite(value) &&
  (open ? value > min : value >= min) &&
  value <= max;

/**
 * Only the values BambuStudio takes (PrintConfig.cpp's bounds; its GUI resets a max volumetric speed under 0.5). A
 * bed temperature of 0 means "this plate can't take it", never a temperature, so it's dropped too.
 */
export function checkedSettings(settings: PresetSettings): PresetSettings {
  const checked: PresetSettings = {};
  if (within(settings.printTemp, 0, 360, true)) checked.printTemp = settings.printTemp as number;
  if (within(settings.bedTemp, 0, 120, true)) checked.bedTemp = settings.bedTemp as number;
  if (within(settings.flowRatio, 0, 2, true)) checked.flowRatio = settings.flowRatio as number;
  if (within(settings.maxVolumetricSpeed, 0.5, 200))
    checked.maxVolumetricSpeed = settings.maxVolumetricSpeed as number;
  if (settings.pressureAdvance && within(settings.pressureAdvance.k, 0, 2))
    checked.pressureAdvance = { ...settings.pressureAdvance };
  return checked;
}

/** Each value from the first source that has it. */
export function layered(...sources: PresetSettings[]): PresetSettings {
  const result: PresetSettings = {};
  for (const source of [...sources].reverse()) Object.assign(result, checkedSettings(source));
  return result;
}

/** The 3DFP record's fields these settings read. */
export interface RecordValues {
  tempMin: number | null;
  tempMax: number | null;
  bedTempMin: number | null;
  bedTempMax: number | null;
  flowRatio: number | null;
  maxVolumetricSpeed: number | null;
  kValue: number | null;
}

/** 3DFP's community values for a filament, as its own generated profiles use them (temperatures at mid-range). */
export function settingsFromRecord(record: RecordValues): PresetSettings {
  const settings: PresetSettings = {};
  const print = midpoint(record.tempMin, record.tempMax);
  const bed = midpoint(record.bedTempMin, record.bedTempMax);
  if (print !== undefined) settings.printTemp = print;
  if (bed !== undefined) settings.bedTemp = bed;
  if (record.flowRatio !== null) settings.flowRatio = record.flowRatio;
  if (record.maxVolumetricSpeed !== null) settings.maxVolumetricSpeed = record.maxVolumetricSpeed;
  // A community K is someone else's printer and nozzle: kept, never turned on.
  if (record.kValue !== null) settings.pressureAdvance = { k: record.kValue, enabled: false };
  return checkedSettings(settings);
}

/** One entry of a 3DFP generated profile's `applied` list. */
export interface AppliedValue {
  key: string;
  value: string;
  source: string;
}

/** The values a 3DFP generated spool profile marks as the spool's own calibration (`source: "spool"`). */
export function settingsFromSpoolProfile(applied: AppliedValue[]): PresetSettings {
  const settings: PresetSettings = {};
  for (const entry of applied) {
    if (entry.source !== "spool") continue;
    const value = Number.parseFloat(entry.value);
    if (!Number.isFinite(value)) continue;
    if (entry.key === "nozzle_temperature") settings.printTemp = value;
    else if (entry.key === "hot_plate_temp" || entry.key === "textured_plate_temp")
      settings.bedTemp ??= value;
    else if (entry.key === "filament_flow_ratio") settings.flowRatio = value;
    else if (entry.key === "filament_max_volumetric_speed") settings.maxVolumetricSpeed = value;
    else if (entry.key === "pressure_advance")
      settings.pressureAdvance = { k: value, enabled: true };
  }
  return checkedSettings(settings);
}

/** The plates a single bed temperature goes to, as Bambu's own presets set them alike; cool and supertack plates
 * differ per material (0 where they can't take it), so the template keeps them. */
const BED_KEYS = [
  "hot_plate_temp",
  "hot_plate_temp_initial_layer",
  "textured_plate_temp",
  "textured_plate_temp_initial_layer",
  "eng_plate_temp",
  "eng_plate_temp_initial_layer",
] as const;

// Per-extruder-variant arrays: replace every real entry, keep "nil" (= use the printer's value).
function everyVariant(value: unknown, replacement: string): unknown {
  if (!Array.isArray(value) || value.length === 0) return [replacement];
  return value.map((entry) => (entry === "nil" ? entry : replacement));
}

/** The template with the settings written over its values; what they leave out stays the template's. */
export function applySettings(preset: PresetConfig, settings: PresetSettings): PresetConfig {
  const result: PresetConfig = { ...preset };
  const checked = checkedSettings(settings);
  if (checked.printTemp !== undefined) {
    const temp = String(checked.printTemp);
    result.nozzle_temperature = everyVariant(preset.nozzle_temperature, temp);
    result.nozzle_temperature_initial_layer = everyVariant(
      preset.nozzle_temperature_initial_layer,
      temp,
    );
  }
  if (checked.bedTemp !== undefined)
    for (const key of BED_KEYS) {
      // 0 is "this plate can't take the filament": a source's bed temperature never turns a plate on.
      const current = preset[key];
      if (Array.isArray(current) && current.every((value) => String(value) === "0")) continue;
      result[key] = [String(checked.bedTemp)];
    }
  if (checked.flowRatio !== undefined)
    result.filament_flow_ratio = everyVariant(
      preset.filament_flow_ratio,
      String(checked.flowRatio),
    );
  if (checked.maxVolumetricSpeed !== undefined)
    result.filament_max_volumetric_speed = everyVariant(
      preset.filament_max_volumetric_speed,
      String(checked.maxVolumetricSpeed),
    );
  if (checked.pressureAdvance) {
    result.enable_pressure_advance = [checked.pressureAdvance.enabled ? "1" : "0"];
    result.pressure_advance = [String(checked.pressureAdvance.k)];
  }
  return result;
}
