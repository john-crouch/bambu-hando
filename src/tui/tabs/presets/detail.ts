// ABOUTME: What the Presets tab lists and shows for a preset: rows grouped by filament ID, filtered, and key settings.
// ABOUTME: Pure functions over UserPreset and the preset's JSON, for the list, the detail panel and the palette.

import type { Preset } from "../../../presetEdit.js";
import type { UserPreset } from "../../../syncCheck.js";
import { shortPrinter } from "../../ui/format.js";
import { filterRows, textWidth } from "../../ui/index.js";

/** A printer as the tab shows it, short: "X1C 0.4". */
export function printerLabel(printer: string): string {
  return shortPrinter(printer);
}

/**
 * Printers in one cell, each model once: "X1C 0.4, 0.6 · P1S 0.4" ("any" for a preset without one).
 * Given a width, the first form that fits: that, "X1C 0.4/0.6 · P1S 0.4", then "X1C ×2 · P1S".
 */
export function printersText(printers: readonly string[], width = Infinity): string {
  const models = new Map<string, string[]>();
  for (const printer of printers) {
    const short = printerLabel(printer) || "any";
    const match = /^(.*) (\d+(?:\.\d+)?)$/.exec(short);
    const [model, nozzle] = match ? [match[1] as string, match[2] as string] : [short, ""];
    const nozzles = models.get(model) ?? [];
    if (nozzle && !nozzles.includes(nozzle)) nozzles.push(nozzle);
    models.set(model, nozzles);
  }
  const form = (each: (model: string, nozzles: string[]) => string) =>
    [...models].map(([model, nozzles]) => each(model, nozzles)).join(" · ");
  const forms = [
    form((model, nozzles) => (nozzles.length ? `${model} ${nozzles.join(", ")}` : model)),
    form((model, nozzles) => (nozzles.length ? `${model} ${nozzles.join("/")}` : model)),
    form((model, nozzles) =>
      nozzles.length > 1 ? `${model} ×${nozzles.length}` : [model, ...nozzles].join(" "),
    ),
  ];
  return forms.find((text) => textWidth(text) <= width) ?? (forms.at(-1) as string);
}

/** A preset's name and short printer, as the tab titles it: "Acme PLA Red @ X1C 0.4". */
export function presetTitle(preset: UserPreset): string {
  return preset.printer ? `${preset.name} @ ${printerLabel(preset.printer)}` : preset.name;
}

/** What a preset is found by: name, printer (as BambuStudio and the tab name it) and filament ID ("no ID" when it has none). */
function searchText(preset: UserPreset): string {
  return `${preset.name} ${preset.printer} ${printerLabel(preset.printer)} ${preset.filamentId || "no ID"}`;
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

/** One row of the list: a filament's presets (sharing its ID and name), one per printer. */
export interface PresetGroup {
  key: string;
  name: string;
  presets: UserPreset[];
}

/** A preset's row: presets with an ID share it by ID and name; one without an ID is a row of its own. */
export function groupKey(preset: UserPreset): string {
  return preset.filamentId
    ? `${preset.filamentId}\u0000${preset.name.toLowerCase()}`
    : `\u0000${preset.path}`;
}

/** The list's rows: presetRows' order, grouped; only the filter's matches. */
export function presetGroups(presets: readonly UserPreset[], filter: string): PresetGroup[] {
  const groups = new Map<string, PresetGroup>();
  for (const preset of presetRows(presets, filter)) {
    const key = groupKey(preset);
    const group = groups.get(key);
    if (group) group.presets.push(preset);
    else groups.set(key, { key, name: preset.name, presets: [preset] });
  }
  return [...groups.values()];
}

/** What a list row shows, for sizing its columns. */
export interface ListCells {
  name: string;
  /** BambuStudio's names of the row's printers. */
  printers: readonly string[];
  /** A preset of the row has unsaved edits. */
  edited: boolean;
  /** "" when the row's presets have none. */
  id: string;
}

/** The columns of a row's cells. */
export interface ListWidths {
  name: number;
  printers: number;
  status: number;
  id: number;
}

/** The gutter mark and the scroll thumb's column; a scrolling list keeps one more free before the thumb. */
function rowEdges(scrolls: boolean): number {
  return scrolls ? 3 : 2;
}

/** Said before anything writes preset files: Presets' review and Check's filament IDs. */
export const CLOSE_BAMBUSTUDIO_FIRST =
  "Close BambuStudio first: it may save its own copy over these presets.";

const NO_ID = "no ID";
const EDITED = "edited";

/** printersText's forms, longest first, as narrow as their widest row: the widths the column can take. */
const PRINTER_FORMS = [Infinity, 11, 7];

/**
 * Column widths for the list's rows in width columns: the name gets its widest, with every other column
 * when that fits; else the ID goes first, then the printers take a shorter form ("X1C 0.4/0.6", "X1C ×2"),
 * and only then is a name cut. The ID column says "no ID" where there's none; status says "edited", and
 * "no ID" too once the IDs are gone; it shows only when a row has something to say there. Each column is
 * as wide as its widest value, so a short printer sits next to its name.
 */
export function listColumns(
  width: number,
  rows: readonly ListCells[],
  scrolls = false,
): ListWidths {
  const cells = Math.max(0, width - rowEdges(scrolls));
  const name = Math.max(0, ...rows.map((r) => textWidth(r.name)));
  const printersAt = (form: number) =>
    Math.max(0, ...rows.map((r) => textWidth(printersText(r.printers, form))));
  const id = Math.min(10, Math.max(0, ...rows.map((r) => textWidth(r.id || NO_ID))));
  const edited = rows.some((r) => r.edited) ? EDITED.length : 0;
  const noId = rows.some((r) => !r.id) ? NO_ID.length : 0;
  const room = (n: number) => (n > 0 ? n + 1 : 0);
  const plans: Omit<ListWidths, "name">[] = [
    { printers: printersAt(Infinity), status: edited, id },
    ...PRINTER_FORMS.map((form) => ({
      printers: printersAt(form),
      status: Math.max(edited, noId),
      id: 0,
    })),
  ];
  for (const plan of plans)
    if (name + room(plan.printers) + room(plan.status) + room(plan.id) <= cells)
      return { name, ...plan };
  const last = plans.at(-1) as Omit<ListWidths, "name">;
  return { name: Math.max(1, cells - room(last.printers) - room(last.status)), ...last };
}

/** A row's status and ID cells as listColumns sized them. */
export function statusCells(
  row: ListCells,
  widths: { id: number },
): { status: string; id: string } {
  if (widths.id > 0) return { status: row.edited ? EDITED : "", id: row.id || NO_ID };
  return { status: row.edited ? EDITED : row.id ? "" : NO_ID, id: "" };
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

/** "Direct Drive High Flow" → "high flow": the nozzle type a variant is for, as BambuStudio names it. */
function variantName(name: string): string {
  return name.replace(/^Direct Drive /, "").toLowerCase();
}

/**
 * A setting with its unit: "220°C"; variants that differ each tagged with their nozzle type when the
 * preset names them ("standard 22 · high flow 29 mm³/s"), else "220 / 230°C".
 */
function shown(preset: Preset, key: string, unit = ""): string {
  const list = values(preset[key]);
  if (list.length === 0) return "";
  const each = preset[key];
  const names = preset.filament_extruder_variant;
  if (
    list.length > 1 &&
    Array.isArray(each) &&
    Array.isArray(names) &&
    names.length === each.length &&
    names.every((n) => typeof n === "string" && n)
  )
    return `${each.map((value, index) => `${variantName(names[index] as string)} ${value}`).join(" · ")}${unit}`;
  return `${list.join(" / ")}${unit}`;
}

function swatchOf(preset: Preset): string | undefined {
  for (const key of ["default_filament_colour", "filament_colour"]) {
    const hex = /^#([0-9a-f]{6})/i.exec(values(preset[key])[0] ?? "")?.[1];
    if (hex) return `#${hex.toUpperCase()}`;
  }
  return undefined;
}

/** "25 per kg", in whatever currency BambuStudio is set to; "" for 0, "no cost given". */
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

/** Flow ratio, max flow and fan in one line when it fits width, else max flow on a line of its own (one wording both ways). */
function flowRows(preset: Preset, fan: string, width: number): DetailRow[] {
  const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
  const ratio = shown(preset, "filament_flow_ratio");
  const max = shown(preset, "filament_max_volumetric_speed", " mm³/s");
  const tagged = (tag: string, value: string) => (value ? `${tag} ${value}` : "");
  const one = join(tagged("ratio", ratio), tagged("max flow", max), tagged("fan", fan));
  if (textWidth(one) <= width || !max) return [{ label: "Flow", value: one }];
  return [
    { label: "Flow", value: join(tagged("ratio", ratio), tagged("fan", fan)) },
    { label: "Max flow", value: max },
  ];
}

/**
 * The same settings in four lines, for a detail panel under the list on a narrow terminal; given the
 * value column's width, a Flow line too long for it puts the max flow on a line of its own.
 */
export function compactDetail(preset: Preset, width = Infinity): DetailRow[] {
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
    ...flowRows(preset, fan, width),
    {
      label: "Filament",
      value: join(shown(preset, "filament_density", " g/cm³"), tagged("cost", costPerKg(preset))),
    },
  ];
  return rows.filter((row) => row.value);
}

/** Words packed into lines of at most width columns (a word longer than that keeps a line of its own). */
function packWords(words: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return line ? [...lines, line] : lines;
}

/** A value in lines of at most width columns: broken after a " · " where it can be, else between words. */
function wrapValue(value: string, width: number): string[] {
  const pieces = value
    .split(" · ")
    .map((piece, index, all) => (index < all.length - 1 ? `${piece} ·` : piece));
  const lines: string[] = [];
  let line = "";
  for (const piece of pieces) {
    const next = line ? `${line} ${piece}` : piece;
    if (textWidth(next) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    if (textWidth(piece) <= width) line = piece;
    else {
      const words = packWords(piece.split(" "), width);
      lines.push(...words.slice(0, -1));
      line = words.at(-1) ?? "";
    }
  }
  return line ? [...lines, line] : lines;
}

/** Rows whose values are too long for width columns go on over rows without a label, never cut. */
export function wrapDetailRows<R extends DetailRow>(rows: readonly R[], width: number): R[] {
  return rows.flatMap((row) => {
    if (textWidth(row.value) <= width) return [row];
    return wrapValue(row.value, width).map((value, index) =>
      index === 0 ? { ...row, value } : { ...row, label: "", value },
    );
  });
}
