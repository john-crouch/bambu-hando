// ABOUTME: What the Presets tab lists and shows for a preset: rows grouped by filament ID, filtered, and key settings.
// ABOUTME: Pure functions over UserPreset and the preset's JSON, for the list, the detail panel and the palette.

import type { Preset } from "../../../presetEdit.js";
import type { UserPreset } from "../../../syncCheck.js";
import { filterRows } from "../../ui/index.js";

/** A printer as the tab shows it: without "Bambu Lab ". */
export function printerLabel(printer: string): string {
  return printer.replace(/^Bambu Lab /, "");
}

/** A preset's name and printer, as the tab titles it. */
export function presetTitle(preset: UserPreset): string {
  return preset.printer ? `${preset.name} @ ${printerLabel(preset.printer)}` : preset.name;
}

/** What a preset is found by: name, printer and filament ID ("no ID" when it has none). */
function searchText(preset: UserPreset): string {
  return `${preset.name} ${preset.printer} ${preset.filamentId || "no ID"}`;
}

/**
 * The presets in list order, those with every word of the filter: presets sharing a filament ID
 * together, groups by name (ignoring case), then by printer.
 */
export function presetRows(presets: readonly UserPreset[], filter: string): UserPreset[] {
  const group = (p: UserPreset) => p.filamentId || `\u0000${p.path}`;
  const groupName = new Map<string, string>();
  for (const p of presets) {
    const name = p.name.toLowerCase();
    const known = groupName.get(group(p));
    if (known === undefined || name < known) groupName.set(group(p), name);
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const matches = filterRows(presets.map(searchText), filter);
  return matches
    .map((match) => presets[match.index] as UserPreset)
    .sort(
      (a, b) =>
        compare(groupName.get(group(a)) ?? "", groupName.get(group(b)) ?? "") ||
        compare(group(a), group(b)) ||
        compare(a.printer, b.printer) ||
        compare(a.path, b.path),
    );
}

export interface DetailRow {
  label: string;
  value: string;
}

export interface PresetDetail {
  /** "#RRGGBB", when the preset has a color. */
  swatch?: string;
  rows: DetailRow[];
}

/** A setting's distinct values (one per variant), or [] when it isn't set or isn't text. */
function values(value: unknown): string[] {
  const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return [...new Set(list.filter((v): v is string => typeof v === "string" && v !== ""))];
}

function shown(preset: Preset, key: string, unit = ""): string {
  const list = values(preset[key]);
  return list.length ? `${list.join(" / ")}${unit}` : "";
}

function swatchOf(preset: Preset): string | undefined {
  for (const key of ["default_filament_colour", "filament_colour"]) {
    const hex = /^#([0-9a-f]{6})/i.exec(values(preset[key])[0] ?? "")?.[1];
    if (hex) return `#${hex.toUpperCase()}`;
  }
  return undefined;
}

/** "25 per kg"; "" for 0, BambuStudio's "no cost given". */
function costPerKg(preset: Preset): string {
  return shown(preset, "filament_cost") === "0" ? "" : shown(preset, "filament_cost", " per kg");
}

/** "30–80%": the part cooling fan's range, or the one end the preset sets. */
function fanRange(preset: Preset): string {
  const low = shown(preset, "fan_min_speed");
  const high = shown(preset, "fan_max_speed");
  if (low && high) return low === high ? `${low}%` : `${low}–${high}%`;
  return low || high ? `${low || high}%` : "";
}

const PLATES: readonly [string, string][] = [
  ["textured_plate_temp", "Textured PEI"],
  ["hot_plate_temp", "Smooth PEI"],
  ["cool_plate_temp", "Cool Plate"],
  ["eng_plate_temp", "Engineering"],
];

/** The settings people check first, with units; settings the preset doesn't have are left out. */
export function presetDetail(preset: Preset): PresetDetail {
  const rows: DetailRow[] = [];
  const add = (label: string, value: string) => {
    if (value) rows.push({ label, value });
  };
  const nozzle = shown(preset, "nozzle_temperature", "°C");
  const first = shown(preset, "nozzle_temperature_initial_layer", "°C");
  add("Nozzle", nozzle && first && first !== nozzle ? `${nozzle} · first layer ${first}` : nozzle);
  const low = shown(preset, "nozzle_temperature_range_low");
  const high = shown(preset, "nozzle_temperature_range_high");
  add("Range", low && high ? `${low}–${high}°C` : "");
  for (const [key, label] of PLATES) {
    const temp = shown(preset, key);
    add(label, temp && temp !== "0" ? `${temp}°C` : "");
  }
  add("Flow ratio", shown(preset, "filament_flow_ratio"));
  add("Max flow", shown(preset, "filament_max_volumetric_speed", " mm³/s"));
  add("Fan", fanRange(preset));
  add("Density", shown(preset, "filament_density", " g/cm³"));
  add("Cost", costPerKg(preset));
  const swatch = swatchOf(preset);
  return swatch ? { swatch, rows } : { rows };
}

const SHORT_PLATES: Record<string, string> = {
  textured_plate_temp: "Textured",
  hot_plate_temp: "Smooth",
  cool_plate_temp: "Cool",
  eng_plate_temp: "Engineering",
};

/** The same settings in at most four lines, for a detail panel under the list on a narrow terminal. */
export function compactDetail(preset: Preset): DetailRow[] {
  const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
  const tagged = (tag: string, value: string) => (value ? `${tag} ${value}` : "");
  const low = shown(preset, "nozzle_temperature_range_low");
  const high = shown(preset, "nozzle_temperature_range_high");
  const nozzle = shown(preset, "nozzle_temperature", "°C");
  const first = shown(preset, "nozzle_temperature_initial_layer", "°C");
  const fan = fanRange(preset);
  const rows: DetailRow[] = [
    {
      label: "Nozzle",
      value: join(
        nozzle,
        first && first !== nozzle ? tagged("first", first) : "",
        low && high ? `range ${low}–${high}°C` : "",
      ),
    },
    {
      label: "Bed",
      value: join(
        ...PLATES.map(([key]) => {
          const temp = shown(preset, key);
          return temp && temp !== "0" ? `${SHORT_PLATES[key]} ${temp}°C` : "";
        }),
      ),
    },
    {
      label: "Flow",
      value: join(
        tagged("ratio", shown(preset, "filament_flow_ratio")),
        tagged("max", shown(preset, "filament_max_volumetric_speed", " mm³/s")),
        tagged("fan", fan),
      ),
    },
    {
      label: "Filament",
      value: join(shown(preset, "filament_density", " g/cm³"), costPerKg(preset)),
    },
  ];
  return rows.filter((row) => row.value);
}
