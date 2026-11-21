// ABOUTME: Remembers the TUI's last choices (the printers presets are written for) so the form starts from them.
// ABOUTME: Stored as JSON in bambu-hando's config directory; damaged or unknown values are ignored.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./atomicWrite.js";
import { configDir } from "./paths.js";

export interface TuiSettings {
  /** BambuStudio printers of the last run; empty when none was saved. */
  printers: string[];
}

export function tuiSettingsPath(): string {
  return join(configDir(), "tui.json");
}

export async function loadTuiSettings(path = tuiSettingsPath()): Promise<TuiSettings> {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return { printers: [] };
  }
  const printers = Array.isArray(saved.printers)
    ? saved.printers.filter((p): p is string => typeof p === "string" && p.trim() !== "")
    : [];
  return { printers };
}

/** Written atomically (a temp file of its own per save), so overlapping or interrupted saves never leave a broken file. */
export async function saveTuiSettings(
  settings: TuiSettings,
  path = tuiSettingsPath(),
): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
}
