// ABOUTME: Installs a minimal real BambuStudio setup (system profiles + BambuStudio.conf) into a temp HOME.
// ABOUTME: The system profiles are copied from a real BambuStudio install; see test/fixtures/bambustudio.

import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SYSTEM_FIXTURE = fileURLToPath(new URL("./fixtures/bambustudio/system", import.meta.url));
export const X1C_04 = "Bambu Lab X1 Carbon 0.4 nozzle";
export const X1C_06 = "Bambu Lab X1 Carbon 0.6 nozzle";

export function bambuConfigDir(home: string): string {
  return join(home, ".config", "BambuStudio");
}

/** Where custom (base) filament presets for a preset folder live. */
export function baseFilamentDir(home: string, presetFolder = "default"): string {
  return join(bambuConfigDir(home), "user", presetFolder, "filament", "base");
}

/**
 * Copy the system profiles and write BambuStudio.conf with the given preset folder and selected
 * printer; pass conf: null to leave BambuStudio.conf out.
 */
export async function installBambuStudio(
  home: string,
  conf: { presetFolder?: string; machine?: string } | null = {},
): Promise<void> {
  const dir = bambuConfigDir(home);
  await mkdir(dir, { recursive: true });
  await cp(SYSTEM_FIXTURE, join(dir, "system"), { recursive: true });
  if (conf === null) return;
  const config = {
    app: { preset_folder: conf.presetFolder ?? "default" },
    presets: { machine: conf.machine ?? X1C_04, filaments: ["Generic PLA"] },
  };
  await writeFile(join(dir, "BambuStudio.conf"), `${JSON.stringify(config, null, 4)}\n`, "utf-8");
}

/** Write the SpoolEase console settings the SpoolEase build of BambuStudio keeps in spoolease/config.json. */
export async function installSpoolEaseConfig(home: string, console: Record<string, unknown>): Promise<void> {
  const dir = join(bambuConfigDir(home), "spoolease");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), `${JSON.stringify({ console, version: 1 }, null, 4)}\n`, "utf-8");
}
