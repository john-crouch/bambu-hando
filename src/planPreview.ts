// ABOUTME: Preview of what a sync would do to each profile: presets new or already there, its custom filament
// ABOUTME: row added, unchanged or updated, and its spool created or already on the console. Reads only.

import { access } from "node:fs/promises";

import { presetPath } from "./bambuStudio.js";
import type { FilamentProfile } from "./models.js";
import { buildCustomFilamentsCsv } from "./spoolease.js";

export interface FilamentPlan {
  /** new: SpoolEase doesn't list the code; update: its row says something else, which the run replaces. */
  state: "new" | "same" | "update";
  /** For an update, what SpoolEase calls the filament now: "<name> <low>-<high> °C". */
  listed: string;
  /** For an update, what the run writes instead, in the same form. */
  becomes: string;
}

export interface ProfilePlan {
  /** Presets the run writes for the profile, one per printer. */
  presets: number;
  /** Of those, the ones already on disk: kept, or replaced when overwriting. */
  existingPresets: number;
  /** null when SpoolEase wasn't read. */
  filament: FilamentPlan | null;
  /** null when SpoolEase wasn't read or the run creates no spools. */
  spool: "create" | "exists" | null;
}

/** What the console holds, as a run reads it before writing. */
export interface ConsoleState {
  /** The custom-filaments CSV as stored. */
  csv: string;
  /** Filament codes that have a spool. */
  spooledIds: ReadonlySet<string>;
}

/** Compares the row a sync would write with the console's row for the same code (the merge replaces it whole). */
function rowText(row: string): string {
  const [, name = "", low = "", high = ""] = row.split(",");
  return `${name} ${low}-${high} °C`;
}

export function filamentPlan(profile: FilamentProfile, csv: string): FilamentPlan {
  const ours = buildCustomFilamentsCsv([profile]);
  const theirs = csv.split(/\r?\n/).find((line) => line.split(",")[0] === profile.filamentId);
  if (theirs === undefined) return { state: "new", listed: "", becomes: "" };
  if (theirs === ours) return { state: "same", listed: "", becomes: "" };
  return { state: "update", listed: rowText(theirs), becomes: rowText(ours) };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export async function previewPlan(
  profiles: FilamentProfile[],
  target: { presetFolder: string; printers: string[] },
  spoolease: ConsoleState | null,
  createSpools: boolean,
): Promise<ProfilePlan[]> {
  return Promise.all(
    profiles.map(async (profile): Promise<ProfilePlan> => {
      const found = await Promise.all(target.printers.map((printer) => exists(presetPath(profile, target.presetFolder, printer))));
      return {
        presets: target.printers.length,
        existingPresets: found.filter(Boolean).length,
        filament: spoolease ? filamentPlan(profile, spoolease.csv) : null,
        spool: spoolease && createSpools ? (spoolease.spooledIds.has(profile.filamentId) ? "exists" : "create") : null,
      };
    }),
  );
}
