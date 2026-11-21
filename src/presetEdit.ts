// ABOUTME: Edits BambuStudio filament presets: a curated set of fields people tune, plus any setting as raw text.
// ABOUTME: Validation, display and applying edits are pure; writing keeps BambuStudio's layout and dates the .info.

import { readFile } from "node:fs/promises";

import { writeAtomic } from "./atomicWrite.js";
import { errorMessage } from "./errors.js";
import type { FilamentProfile } from "./models.js";
import { touchInfo } from "./presetIds.js";
import type { UserPreset } from "./syncCheck.js";

export type Preset = Record<string, unknown>;

/**
 * What an edit writes: one value for every variant (or the string); one value per variant; or one
 * nozzle type's value (a filament_extruder_variant name), which goes to every variant of the preset
 * that held the same value as that one, so a variant set apart keeps its own.
 */
export type EditValue = { every: string } | { each: string[] } | { variant: string; value: string };

/** The value an edit writes (a per-variant list's first). */
export function editedText(edit: EditValue): string {
  if ("every" in edit) return edit.every;
  if ("variant" in edit) return edit.value;
  return edit.each[0] ?? "";
}

/** Edits by preset key. */
export type Edits = ReadonlyMap<string, EditValue>;

export type FieldKind = "int" | "decimal" | "switch" | "color" | "text";

export interface EditField {
  key: string;
  label: string;
  group: string;
  kind: FieldKind;
  unit?: string;
  min?: number;
  max?: number;
  /** "nil" is a value: the printer's own setting. Typing nothing sets it. */
  nilable?: boolean;
  /** The key holds a string, not a list of one value per variant. */
  scalar?: boolean;
}

const temp = (key: string, label: string, group: string, max: number): EditField => ({
  key,
  label,
  group,
  kind: "int",
  unit: "°C",
  min: 0,
  max,
});

/** The fields the edit form shows, in order; everything else is under All settings. */
export const EDIT_FIELDS: readonly EditField[] = [
  temp("nozzle_temperature", "Nozzle", "Temperature", 500),
  temp("nozzle_temperature_initial_layer", "Nozzle, first layer", "Temperature", 500),
  temp("nozzle_temperature_range_low", "Nozzle range, low", "Temperature", 500),
  temp("nozzle_temperature_range_high", "Nozzle range, high", "Temperature", 500),
  temp("textured_plate_temp", "Textured PEI", "Bed", 200),
  temp("textured_plate_temp_initial_layer", "Textured PEI, first layer", "Bed", 200),
  temp("hot_plate_temp", "Smooth PEI / High Temp", "Bed", 200),
  temp("hot_plate_temp_initial_layer", "Smooth PEI, first layer", "Bed", 200),
  temp("cool_plate_temp", "Cool Plate", "Bed", 200),
  temp("cool_plate_temp_initial_layer", "Cool Plate, first layer", "Bed", 200),
  temp("eng_plate_temp", "Engineering Plate", "Bed", 200),
  temp("eng_plate_temp_initial_layer", "Engineering, first layer", "Bed", 200),
  {
    key: "filament_flow_ratio",
    label: "Flow ratio",
    group: "Flow",
    kind: "decimal",
    min: 0.01,
    max: 2,
  },
  {
    key: "filament_max_volumetric_speed",
    label: "Max volumetric speed",
    group: "Flow",
    kind: "decimal",
    unit: "mm³/s",
    min: 0.1,
    max: 200,
  },
  { key: "enable_pressure_advance", label: "Pressure advance", group: "Flow", kind: "switch" },
  {
    key: "pressure_advance",
    label: "Pressure advance K",
    group: "Flow",
    kind: "decimal",
    min: 0,
    max: 2,
  },
  {
    key: "filament_retraction_length",
    label: "Retraction length",
    group: "Retraction",
    kind: "decimal",
    unit: "mm",
    min: 0,
    max: 20,
    nilable: true,
  },
  {
    key: "filament_retraction_speed",
    label: "Retraction speed",
    group: "Retraction",
    kind: "decimal",
    unit: "mm/s",
    min: 1,
    max: 500,
    nilable: true,
  },
  {
    key: "fan_min_speed",
    label: "Fan, min",
    group: "Cooling",
    kind: "int",
    unit: "%",
    min: 0,
    max: 100,
  },
  {
    key: "fan_max_speed",
    label: "Fan, max",
    group: "Cooling",
    kind: "int",
    unit: "%",
    min: 0,
    max: 100,
  },
  { key: "default_filament_colour", label: "Color", group: "Filament", kind: "color" },
  {
    key: "filament_density",
    label: "Density",
    group: "Filament",
    kind: "decimal",
    unit: "g/cm³",
    min: 0.1,
    max: 20,
  },
  {
    key: "filament_cost",
    label: "Cost per kg",
    group: "Filament",
    kind: "decimal",
    min: 0,
    max: 100_000,
  },
  { key: "filament_notes", label: "Notes", group: "Filament", kind: "text", scalar: true },
];

export function editField(key: string): EditField | undefined {
  return EDIT_FIELDS.find((f) => f.key === key);
}

/** Curated settings tuned per nozzle size: an edit of one goes to the preset it was made on unless asked. */
const NOZZLE_FIELDS = new Set([
  "filament_max_volumetric_speed",
  "enable_pressure_advance",
  "pressure_advance",
  "filament_retraction_length",
  "filament_retraction_speed",
]);

/** Whether a setting belongs to the nozzle size (and raw settings, which may): not copied to the other sizes by default. */
export function nozzleSpecific(key: string): boolean {
  return NOZZLE_FIELDS.has(key) || !editField(key);
}

/** BambuStudio's filament_extruder_variant when a preset lists none. */
const DEFAULT_VARIANTS = ["Direct Drive Standard"];

/** The preset's nozzle types, one per variant of its per-variant settings ("Direct Drive High Flow"). */
export function variantNames(preset: Preset): string[] {
  const names = preset.filament_extruder_variant;
  return Array.isArray(names) && names.length > 0 && names.every((n) => typeof n === "string")
    ? names
    : DEFAULT_VARIANTS;
}

/** BambuStudio's extruder types, in the order a variant for the nozzle type is looked for. */
const EXTRUDER_TYPES = ["Direct Drive", "Bowden"];

/**
 * The variant BambuStudio prints with for the printer's nozzle type (BambuStudio.conf's
 * nozzle_volume_types: "Standard", "High Flow"): the one named exactly "<extruder type> <nozzle type>",
 * Direct Drive first; the first when the preset has none of those names, as BambuStudio falls back.
 */
export function activeVariant(preset: Preset, nozzleType: string): number {
  const names = variantNames(preset);
  if (!nozzleType) return 0;
  for (const extruder of EXTRUDER_TYPES) {
    const index = names.indexOf(`${extruder} ${nozzleType}`);
    if (index >= 0) return index;
  }
  return 0;
}

const LOCKED: Record<string, string> = {
  name: "it comes from the file name",
  filament_settings_id: "BambuStudio keeps it equal to the name",
  filament_id: "it links the preset to SpoolEase's filaments and spools",
  inherits: "it says which preset this one copies",
  from: "BambuStudio sets it",
  version: "BambuStudio skips presets without the right one",
  setting_id: "it's the preset's ID in the Bambu cloud",
};

/** Why a key can't be edited here; "" when it can. */
export function lockedReason(key: string): string {
  return LOCKED[key] ?? "";
}

// A setting shows on one line: newlines and carriage returns as \n and \r, a backslash doubled.
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function unescapeText(text: string): string {
  return text.replace(/\\(\\|n|r)/g, (_, c: string) =>
    c === "n" ? "\n" : c === "r" ? "\r" : "\\",
  );
}

function entries(value: unknown): string[] | null {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string"))
    return value.length ? value : [""];
  return null;
}

function shownEntry(field: EditField, entry: string): string {
  if (field.nilable && entry === "nil") return "printer's";
  switch (field.kind) {
    case "switch":
      return entry === "1" ? "on" : "off";
    case "color":
      return entry ? entry.toUpperCase() : "none";
    case "text":
      return entry ? escapeText(entry) : "none";
    default:
      return field.unit ? `${entry} ${field.unit}` : entry;
  }
}

/** A field's value as the form shows it: with its unit, one per variant when they differ. */
export function shownValue(field: EditField, value: unknown): string {
  if (value === undefined) return "not set";
  const list = entries(value);
  if (!list) return JSON.stringify(value);
  return [...new Set(list.map((entry) => shownEntry(field, entry)))].join(" / ");
}

/** The text editing a field starts from: its variant at index (else its first), with the printer's value as nothing. */
export function fieldText(field: EditField, value: unknown, index = 0): string {
  const list = entries(value);
  const first = list?.[index] ?? list?.[0] ?? "";
  if (field.nilable && first === "nil") return "";
  if (field.kind === "color") return first.replace(/^#/, "");
  if (field.kind === "text") return escapeText(first);
  return first;
}

function rangeText(field: EditField): string {
  return `from ${field.min} to ${field.max}${field.nilable ? ", or nothing for the printer's" : ""}`;
}

/** What typing `text` into the field writes, or why it can't. */
export function parseField(field: EditField, text: string): { value: string } | { error: string } {
  const typed = text.trim();
  if (field.nilable && !typed) return { value: "nil" };
  switch (field.kind) {
    case "int": {
      const n = Number(typed);
      if (!/^-?\d+$/.test(typed) || n < (field.min ?? -Infinity) || n > (field.max ?? Infinity))
        return { error: `${field.label}: type a whole number ${rangeText(field)}` };
      return { value: String(n) };
    }
    case "decimal": {
      const n = Number(typed);
      if (
        !/^-?(\d+\.?\d*|\.\d+)$/.test(typed) ||
        n < (field.min ?? -Infinity) ||
        n > (field.max ?? Infinity)
      )
        return { error: `${field.label}: type a number ${rangeText(field)}` };
      return { value: String(n) };
    }
    case "switch":
      if (/^(1|on)$/i.test(typed)) return { value: "1" };
      if (/^(0|off)$/i.test(typed)) return { value: "0" };
      return { error: `${field.label}: on or off` };
    case "color": {
      if (!typed) return { value: "" };
      const hex = /^#?([0-9a-f]{6})$/i.exec(typed)?.[1];
      return hex
        ? { value: `#${hex.toUpperCase()}` }
        : { error: `${field.label}: type 6 hex digits, such as AD0000, or nothing for none` };
    }
    case "text":
      return { value: unescapeText(text) };
  }
}

function differs(list: string[]): boolean {
  return list.some((entry) => entry !== list[0]);
}

/**
 * A setting as raw text: a string, or a list whose variants agree, as its one value (newlines as \n); a
 * list whose variants differ as JSON. null for anything else, which isn't edited here.
 */
export function rawText(value: unknown): string | null {
  if (typeof value === "string") return escapeText(value);
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return null;
  const [first] = value;
  if (first === undefined) return "";
  return differs(value) ? JSON.stringify(value) : escapeText(first);
}

/** Reads raw text back the way rawText showed the current value. */
export function parseRaw(current: unknown, text: string): { edit: EditValue } | { error: string } {
  if (Array.isArray(current) && current.every((v) => typeof v === "string") && differs(current)) {
    const example = `as a JSON list, such as ${JSON.stringify(current.map((_, i) => `value ${i + 1}`))}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: `Type ${current.length} values ${example}` };
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== current.length ||
      !parsed.every((v) => typeof v === "string")
    ) {
      return { error: `Type ${current.length} values ${example}` };
    }
    return { edit: { each: parsed } };
  }
  if (rawText(current) === null)
    return { error: "This setting isn't text; change it in BambuStudio" };
  return { edit: { every: unescapeText(text) } };
}

function applyValue(
  current: unknown,
  edit: EditValue,
  missingAsString: boolean,
  names: string[],
): unknown {
  if ("variant" in edit) {
    if (!Array.isArray(current) || current.length === 0)
      return applyValue(current, { every: edit.value }, missingAsString, names);
    // The variant's place in this preset, else its first (BambuStudio's fallback).
    const at = names.length === current.length ? names.indexOf(edit.variant) : -1;
    const old = current[Math.max(0, at)];
    return current.map((entry) => (entry === old ? edit.value : entry));
  }
  if ("each" in edit)
    return Array.isArray(current) && current.length === edit.each.length
      ? [...edit.each]
      : undefined;
  if (typeof current === "string") return edit.every;
  if (Array.isArray(current)) {
    if (current.length === 0) return [edit.every];
    // "nil" is the printer's value: kept, as buildPreset's everyVariant keeps it, unless that's all there is.
    const real = current.some((entry) => entry !== "nil");
    return current.map((entry) => (real && entry === "nil" ? entry : edit.every));
  }
  if (current === undefined) return missingAsString ? edit.every : [edit.every];
  return undefined;
}

/** The preset with the edits; keys keep their order and a missing curated key goes last. skipped: edits that don't fit it. */
export function applyEdits(preset: Preset, edits: Edits): { preset: Preset; skipped: string[] } {
  const next: Preset = { ...preset };
  const skipped: string[] = [];
  for (const [key, edit] of edits) {
    const value = applyValue(
      preset[key],
      edit,
      editField(key)?.scalar ?? false,
      variantNames(preset),
    );
    if (value === undefined) skipped.push(key);
    else next[key] = value;
  }
  return { preset: next, skipped };
}

export interface EditChange {
  key: string;
  /** The field's label, or the key for a raw setting. */
  label: string;
  from: string;
  to: string;
}

function shownRaw(field: EditField | undefined, value: unknown): string {
  if (field) return shownValue(field, value);
  return value === undefined ? "not set" : (rawText(value) ?? JSON.stringify(value));
}

/** A setting's value for people: a curated field's as the form shows it, any other as its raw text. */
export function shownSetting(key: string, value: unknown): string {
  return shownRaw(editField(key), value);
}

/** What the edits change in `preset`, in the order they were made; edits that change nothing are left out. */
export function editChanges(preset: Preset, edits: Edits): EditChange[] {
  const edited = applyEdits(preset, edits).preset;
  return [...edits.keys()].flatMap((key) => {
    if (JSON.stringify(preset[key]) === JSON.stringify(edited[key])) return [];
    const field = editField(key);
    return [
      {
        key,
        label: field?.label ?? key,
        from: shownRaw(field, preset[key]),
        to: shownRaw(field, edited[key]),
      },
    ];
  });
}

function firstNumber(value: unknown): number | null {
  const n = Number(entries(value)?.[0]);
  return entries(value) && Number.isFinite(n) ? n : null;
}

/** The preset's nozzle temperature range (its first variant's); null unless both ends are numbers. */
export function nozzleRange(preset: Preset): { low: number; high: number } | null {
  const low = firstNumber(preset.nozzle_temperature_range_low);
  const high = firstNumber(preset.nozzle_temperature_range_high);
  return low !== null && high !== null ? { low, high } : null;
}

/**
 * The nozzle range a sync gives SpoolEase for a filament: a kept preset's (the run leaves it as it is,
 * tuned or not), else the profile's with the plan's edits, as the presets it writes get them.
 */
export function syncedRange(
  profile: FilamentProfile,
  kept: Preset[],
  edits?: Edits,
): { low: number; high: number } {
  for (const preset of kept) {
    const range = nozzleRange(preset);
    if (range) return range;
  }
  // buildPreset writes the profile's range as one value each, so the edits apply to it as they do there.
  const built: Preset = {
    nozzle_temperature_range_low: [String(profile.nozzleTempMin)],
    nozzle_temperature_range_high: [String(profile.nozzleTempMax)],
  };
  return (
    nozzleRange(edits ? applyEdits(built, edits).preset : built) ?? {
      low: profile.nozzleTempMin,
      high: profile.nozzleTempMax,
    }
  );
}

/** A preset file's settings; null when it can't be read or isn't a preset. */
export async function readPreset(path: string): Promise<Preset | null> {
  try {
    const preset: unknown = JSON.parse(await readFile(path, "utf-8"));
    return typeof preset === "object" && preset !== null && !Array.isArray(preset)
      ? (preset as Preset)
      : null;
  } catch {
    return null;
  }
}

/** BambuStudio's nozzle range must run low to high; "" when it does. */
export function rangeError(preset: Preset): string {
  const range = nozzleRange(preset);
  return range && range.low > range.high
    ? `Nozzle range: low (${range.low} °C) is above high (${range.high} °C)`
    : "";
}

/** The opened preset, then the other presets of the same filament (by filament ID), which an edit can change too. */
export function presetFamily(presets: UserPreset[], opened: UserPreset): UserPreset[] {
  const others = opened.filamentId
    ? presets.filter((p) => p.path !== opened.path && p.filamentId === opened.filamentId)
    : [];
  return [opened, ...others];
}

export interface EditResult {
  path: string;
  ok: boolean;
  /** Why it was left as it is, or which edits didn't fit it. */
  detail: string;
}

/** Which of the edits didn't fit the preset (applyEdits' skipped), and why. */
export function skippedDetail(preset: Preset, edits: Edits, skipped: string[]): string {
  return [...edits]
    .filter(([key]) => skipped.includes(key))
    .map(([key, edit]) => {
      const current = preset[key];
      const wanted = "each" in edit ? edit.each.length : 1;
      const why =
        current === undefined
          ? "the preset doesn't have it"
          : Array.isArray(current)
            ? `it has ${current.length} variant${current.length === 1 ? "" : "s"}, not ${wanted}`
            : "it isn't text";
      return `${key} left as it is: ${why}`;
    })
    .join("; ");
}

/** Writes the same edits into each preset (writePresetTargets with one set of edits for all). */
export function writePresetEdits(
  paths: string[],
  edits: Edits,
  nowMs: number = Date.now(),
): Promise<EditResult[]> {
  return writePresetTargets(
    paths.map((path) => ({ path, edits })),
    nowMs,
  );
}

/**
 * Writes each preset its own edits, read again just before, one file at a time; dates its .info so
 * BambuStudio's cloud sync uploads the change. A preset that already has the values isn't written.
 */
export async function writePresetTargets(
  targets: readonly { path: string; edits: Edits }[],
  nowMs: number = Date.now(),
): Promise<EditResult[]> {
  const results: EditResult[] = [];
  for (const { path, edits } of targets) {
    let preset: Preset;
    try {
      preset = JSON.parse(await readFile(path, "utf-8"));
    } catch (err) {
      results.push({ path, ok: false, detail: `couldn't read it: ${errorMessage(err)}` });
      continue;
    }
    const { preset: edited, skipped } = applyEdits(preset, edits);
    const detail = skippedDetail(preset, edits, skipped);
    if (JSON.stringify(edited) === JSON.stringify(preset)) {
      results.push({
        path,
        ok: true,
        detail: detail || "it already had these values; left as it is",
      });
      continue;
    }
    try {
      // BambuStudio's 4-space layout, keys in the file's order, so only the edited keys differ.
      await writeAtomic(path, `${JSON.stringify(edited, null, 4)}\n`);
      await touchInfo(path, nowMs);
      results.push({ path, ok: true, detail });
    } catch (err) {
      results.push({ path, ok: false, detail: `couldn't write it: ${errorMessage(err)}` });
    }
  }
  return results;
}
