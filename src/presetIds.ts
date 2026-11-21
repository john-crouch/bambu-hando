// ABOUTME: Gives BambuStudio presets without a filament ID (missing, or the string "null") the ID BambuStudio would make.
// ABOUTME: Writes filament_id into each preset and dates its .info, so cloud sync uploads the change.

import { readFile, writeFile } from "node:fs/promises";

import { writeAtomic } from "./atomicWrite.js";
import { errorMessage } from "./errors.js";
import { derivedFilamentId } from "./sources.js";
import type { UserPreset } from "./syncCheck.js";

export interface IdFix {
  path: string;
  /** The filament's name, without " @<printer>". */
  name: string;
  printer: string;
  id: string;
}

export interface IdFixResult extends IdFix {
  ok: boolean;
  /** Why the preset was left as it is. */
  detail: string;
}

/** BambuStudio's scheme for a new filament ("P" + md5 of its name), so every printer's preset gets the same ID. */
export function idFixes(presets: UserPreset[]): IdFix[] {
  return presets
    .filter((p) => !p.filamentId)
    .map((p) => ({
      path: p.path,
      name: p.name,
      printer: p.printer,
      id: derivedFilamentId(p.name),
    }));
}

function hasNoId(value: unknown): boolean {
  return value === undefined || value === null || value === "" || value === "null";
}

// BambuStudio's cloud sync (Preset.cpp, PresetCollection) keeps a local preset whose .info updated_time is newer
// than the cloud's copy and marks it to upload; an older or equal one is left alone, or replaced by a newer
// cloud copy. So the edit has to move updated_time forward to reach the account.
export async function touchInfo(presetPath: string, nowMs: number): Promise<void> {
  const infoPath = `${presetPath.slice(0, -".json".length)}.info`;
  let info: string;
  try {
    info = await readFile(infoPath, "utf-8");
  } catch {
    return;
  }
  const seconds = String(Math.floor(nowMs / 1000));
  const dated = /^updated_time = .*$/m.test(info)
    ? info.replace(/^updated_time = .*$/m, `updated_time = ${seconds}`)
    : `${info}updated_time = ${seconds}\n`;
  await writeFile(infoPath, dated, "utf-8");
}

/** Writes each fix, one file at a time; a preset that has an ID by now, or can't be read, is left as it is. */
export async function fixPresetIds(
  fixes: IdFix[],
  nowMs: number = Date.now(),
): Promise<IdFixResult[]> {
  const results: IdFixResult[] = [];
  for (const fix of fixes) {
    let preset: Record<string, unknown>;
    try {
      preset = JSON.parse(await readFile(fix.path, "utf-8"));
    } catch (err) {
      results.push({ ...fix, ok: false, detail: `couldn't read it: ${errorMessage(err)}` });
      continue;
    }
    if (!hasNoId(preset.filament_id)) {
      results.push({
        ...fix,
        ok: false,
        detail: `it has filament ID ${String(preset.filament_id)} now; left as it is`,
      });
      continue;
    }
    try {
      // Keys keep their order (a missing filament_id goes last) and BambuStudio's 4-space layout, so only
      // filament_id differs.
      await writeAtomic(
        fix.path,
        `${JSON.stringify({ ...preset, filament_id: fix.id }, null, 4)}\n`,
      );
      await touchInfo(fix.path, nowMs);
      results.push({ ...fix, ok: true, detail: "" });
    } catch (err) {
      results.push({ ...fix, ok: false, detail: `couldn't write it: ${errorMessage(err)}` });
    }
  }
  return results;
}
