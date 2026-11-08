// ABOUTME: Read-only check that BambuStudio presets, SpoolEase's custom filaments and its spools agree.
// ABOUTME: Lists what doesn't line up, problems first, and changes nothing.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "./errors.js";
import { bambuBaseFilamentDir, bambuFilamentDir } from "./paths.js";
import type { SpoolRecord } from "./spoolease.js";

/** A BambuStudio user preset with its own filament_id: one per filament and printer. */
export interface UserPreset {
  /** The filament's name, without " @<printer>". */
  name: string;
  /** "" when the preset has none, or the string "null". */
  filamentId: string;
  printer: string;
}

export interface CheckSection {
  key: "csvOnly" | "unknownCode" | "badRows" | "presetsOnly" | "presetsNoId" | "noCode";
  title: string;
  /** What it means and what to do about it. */
  why: string;
  /** Problems break the link between a spool and its preset; notes are worth knowing. */
  problem: boolean;
  items: string[];
}

// Inferred from the BBL bundle: every system filament_id starts with "GF" (GFA00, GFL99, …), and
// SpoolEase takes a Bambu Lab spool's code from its tag, so those codes need no custom filament.
const BAMBU_CODE = /^GF/;

function splitPresetName(name: string): { name: string; printer: string } {
  const at = name.lastIndexOf(" @");
  return at < 0 ? { name, printer: "" } : { name: name.slice(0, at), printer: name.slice(at + 2) };
}

/**
 * The presets of a preset folder that don't inherit a system preset, from filament/ and filament/base/.
 * Presets inheriting one (BambuStudio's "save as" copies) share its filament ID and are skipped.
 */
export async function readUserPresets(presetFolder: string): Promise<{ presets: UserPreset[]; warnings: string[] }> {
  const presets: UserPreset[] = [];
  const warnings: string[] = [];
  for (const dir of [bambuBaseFilamentDir(presetFolder), bambuFilamentDir(presetFolder)]) {
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
      const path = join(dir, file);
      let preset: Record<string, unknown>;
      try {
        preset = JSON.parse(await readFile(path, "utf-8"));
      } catch (err) {
        warnings.push(`Couldn't read BambuStudio preset ${path}: ${errorMessage(err)}`);
        continue;
      }
      if (typeof preset.inherits === "string" && preset.inherits) continue;
      // Seen in real presets made outside BambuStudio's Create filament: the string "null" as the ID.
      const id = typeof preset.filament_id === "string" && preset.filament_id !== "null" ? preset.filament_id : "";
      const name = typeof preset.name === "string" && preset.name ? preset.name : file.slice(0, -".json".length);
      presets.push({ ...splitPresetName(name), filamentId: id });
    }
  }
  return { presets, warnings };
}

function spoolLine(spool: SpoolRecord): string {
  return `#${spool.id} ${[spool.brand, spool.material, spool.colorName].filter(Boolean).join(" ")}`;
}

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });
const newestFirst = (a: SpoolRecord, b: SpoolRecord): number => Number(b.id) - Number(a.id);

interface CheckInput {
  presets: UserPreset[];
  /** SpoolEase's custom-filaments CSV as stored. */
  csv: string;
  spools: SpoolRecord[];
}

export function checkSync({ presets, csv, spools }: CheckInput): CheckSection[] {
  // SpoolEase splits each row on every comma (view_model.rs), so this does too.
  const rows = csv.split(/\r?\n/).filter((line) => line.trim());
  const names = new Map<string, string>();
  const badRows: string[] = [];
  rows.forEach((line, index) => {
    const fields = line.split(",");
    const code = fields[0] ?? "";
    const first = rows.findIndex((other) => other.split(",")[0] === code);
    if (fields.length !== 5) badRows.push(`row ${index + 1}: ${line}`);
    else if (first !== index) badRows.push(`row ${index + 1}: ${code} again (row ${first + 1} has it)`);
    if (!names.has(code)) names.set(code, fields[1] ?? "");
  });

  const presetIds = new Set(presets.map((p) => p.filamentId));
  const presetsOnly = new Map<string, UserPreset[]>();
  const presetsNoId = new Map<string, UserPreset[]>();
  for (const preset of presets) {
    if (names.has(preset.filamentId)) continue;
    const [groups, key] = preset.filamentId ? [presetsOnly, preset.filamentId] : [presetsNoId, preset.name];
    groups.set(key, [...(groups.get(key) ?? []), preset]);
  }
  const printersOf = (group: UserPreset[]): string => group.map((p) => p.printer).join(", ");

  return [
    {
      key: "csvOnly",
      title: "SpoolEase filaments without a BambuStudio preset",
      why: "Spools of these find no preset in the AMS: sync them again, or check the preset folder in Settings.",
      problem: true,
      items: [...names]
        .filter(([code]) => !presetIds.has(code))
        .map(([code, name]) => `${name} (${code})`)
        .sort(byName),
    },
    {
      key: "unknownCode",
      title: "Spools whose filament SpoolEase doesn't list",
      why: "Their code is neither a custom filament nor a Bambu Lab one, so nothing names them or finds their preset.",
      problem: true,
      items: spools
        .filter((s) => s.slicerFilament && !names.has(s.slicerFilament) && !BAMBU_CODE.test(s.slicerFilament))
        .sort(newestFirst)
        .map((s) => `${spoolLine(s)} (${s.slicerFilament})`),
    },
    {
      key: "badRows",
      title: "Custom filament rows SpoolEase misreads",
      why: "Each row must be code,name,low temp,high temp,material, with no other commas, and one row per code.",
      problem: true,
      items: badRows,
    },
    {
      key: "presetsOnly",
      title: "BambuStudio presets SpoolEase doesn't know",
      why: "Fine for filaments you only use in BambuStudio; sync one to give its spools a preset in the AMS.",
      problem: false,
      items: [...presetsOnly.values()]
        .map((group) => `${group[0]!.name} (${group[0]!.filamentId}) · ${printersOf(group)}`)
        .sort(byName),
    },
    {
      key: "presetsNoId",
      title: "BambuStudio presets without a filament ID",
      why: "Their filament_id is missing or \"null\", so no spool can ever be matched to them.",
      problem: false,
      items: [...presetsNoId.values()].map((group) => `${group[0]!.name} · ${printersOf(group)}`).sort(byName),
    },
    {
      key: "noCode",
      title: "Spools without a filament code",
      why: "Nothing links them to a preset: set their filament in SpoolEase.",
      problem: false,
      items: spools
        .filter((s) => !s.slicerFilament)
        .sort(newestFirst)
        .map(spoolLine),
    },
  ];
}
