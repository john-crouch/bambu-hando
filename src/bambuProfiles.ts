// ABOUTME: Reads BambuStudio's installed system profiles (BBL vendor bundle) and BambuStudio.conf.
// ABOUTME: Resolves inherits chains and picks the Generic filament preset to clone for a material and printer.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "./errors.js";
import { bambuConfigDir } from "./paths.js";

/** Used when BambuStudio.conf doesn't name a selected printer. */
export const DEFAULT_PRINTER = "Bambu Lab X1 Carbon 0.4 nozzle";

export type PresetConfig = Record<string, unknown>;

export interface Template {
  name: string;
  /** Fully resolved settings (inherits chain merged, child values winning). */
  config: PresetConfig;
}

interface BundleIndex {
  version?: unknown;
  filament_list?: { name: string; sub_path: string }[];
  machine_list?: { name: string; sub_path: string }[];
}

const VENDOR = "BBL";

async function readJson(path: string): Promise<PresetConfig> {
  return JSON.parse(await readFile(path, "utf-8"));
}

function first(value: unknown): string {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}

// "02.08.00.09" -> "2.8.0.9"; BambuStudio skips user presets whose version doesn't parse.
function normalizeVersion(value: unknown): string {
  const parts = String(value ?? "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return parts.length >= 3 && parts.every(Number.isFinite) ? parts.join(".") : "1.0.0.0";
}

export class SystemProfiles {
  private readonly resolved = new Map<string, PresetConfig>();

  private constructor(
    /** Version stamped on presets cloned from this bundle. */
    readonly version: string,
    private readonly filaments: Map<string, PresetConfig>,
    private readonly printerNames: string[],
  ) {}

  /**
   * Load the BBL bundle from <configDir>/system. Only Generic filament presets (and their ancestors)
   * are read: they are the templates custom filaments are cloned from.
   */
  static async load(configDir: string): Promise<SystemProfiles> {
    const systemDir = join(configDir, "system");
    let index: BundleIndex;
    try {
      index = await readJson(join(systemDir, `${VENDOR}.json`));
    } catch {
      throw new Error(
        `BambuStudio system profiles not found in ${systemDir}: start BambuStudio once so it installs them`,
      );
    }

    const paths = new Map(
      (index.filament_list ?? []).map((entry) => [
        entry.name,
        join(systemDir, VENDOR, entry.sub_path),
      ]),
    );
    const filaments = new Map<string, PresetConfig>();
    const loadChain = async (name: string): Promise<void> => {
      const path = paths.get(name);
      if (!path || filaments.has(name)) return;
      try {
        const preset = await readJson(path);
        filaments.set(name, preset);
        if (typeof preset.inherits === "string" && preset.inherits)
          await loadChain(preset.inherits);
      } catch (err) {
        throw new Error(`Failed to read BambuStudio system preset ${path}: ${errorMessage(err)}`);
      }
    };
    await Promise.all(
      [...paths.keys()].filter((name) => name.startsWith("Generic ")).map(loadChain),
    );

    const printerNames: string[] = [];
    for (const entry of index.machine_list ?? []) {
      const machine = await readJson(join(systemDir, VENDOR, entry.sub_path)).catch(() => null);
      if (machine?.instantiation === "true") printerNames.push(entry.name);
    }

    return new SystemProfiles(normalizeVersion(index.version), filaments, printerNames);
  }

  /** Printer preset names BambuStudio can instantiate, e.g. "Bambu Lab X1 Carbon 0.4 nozzle". */
  printers(): string[] {
    return [...this.printerNames];
  }

  /** A loaded preset with its inherits chain merged in (child values win). */
  resolve(name: string): PresetConfig {
    const cached = this.resolved.get(name);
    if (cached) return { ...cached };
    const preset = this.filaments.get(name);
    if (!preset) throw new Error(`unknown BambuStudio system preset ${name}`);
    const parent =
      typeof preset.inherits === "string" && preset.inherits ? this.resolve(preset.inherits) : {};
    const config = { ...parent, ...preset };
    this.resolved.set(name, config);
    return { ...config };
  }

  /**
   * The Generic preset to clone for a material on a printer: an exact filament_type match, else the
   * base material ("PLA+" -> PLA, "TPU-95A" -> TPU). The shortest name wins ("Generic PETG" over
   * "Generic PETG HF @BBL X1C").
   */
  template(material: string, printer: string): Template | null {
    const base = material.split(/[^A-Z0-9]/i)[0] ?? "";
    for (const type of [material, base]) {
      const candidates: Template[] = [];
      for (const [name, preset] of this.filaments) {
        if (!name.startsWith("Generic ") || preset.instantiation !== "true") continue;
        const config = this.resolve(name);
        const printers = config.compatible_printers;
        if (
          first(config.filament_type) === type &&
          Array.isArray(printers) &&
          printers.includes(printer)
        )
          candidates.push({ name, config });
      }
      candidates.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
      if (candidates[0]) return candidates[0];
    }
    return null;
  }
}

/** BambuStudio's nozzle types (NozzleVolumeType's names), each a filament_extruder_variant's second half. */
const NOZZLE_TYPES = new Set([
  "Standard",
  "High Flow",
  "TPU High Flow",
  "TPU285",
  "Hybrid",
  "E3D High Flow",
]);

export interface BambuStudioConf {
  presetFolder: string | null;
  printer: string | null;
  /** nozzle_volume_types: each printer preset's nozzle type ("High Flow"), the first extruder's when it lists several. */
  nozzleTypes: Record<string, string>;
}

/** The logged-in preset folder, selected printer and nozzle types from BambuStudio.conf; nulls (and none) when unknown. */
export async function readBambuStudioConf(configDir: string): Promise<BambuStudioConf> {
  try {
    const conf = await readJson(join(configDir, "BambuStudio.conf"));
    const app = conf.app as Record<string, unknown> | undefined;
    const presets = conf.presets as Record<string, unknown> | undefined;
    const text = (value: unknown) => (typeof value === "string" && value ? value : null);
    const types = conf.nozzle_volume_types;
    const nozzleTypes: Record<string, string> = {};
    if (types && typeof types === "object" && !Array.isArray(types))
      for (const [printer, value] of Object.entries(types))
        if (typeof value === "string") nozzleTypes[printer] = value.split(",")[0]?.trim() ?? "";
    return { presetFolder: text(app?.preset_folder), printer: text(presets?.machine), nozzleTypes };
  } catch {
    return { presetFolder: null, printer: null, nozzleTypes: {} };
  }
}

/** The printer preset's nozzle type in BambuStudio; Standard when it's missing or not one BambuStudio knows. */
export function nozzleTypeFor(types: Record<string, string>, printer: string): string {
  const type = types[printer] ?? "";
  return NOZZLE_TYPES.has(type) ? type : "Standard";
}

/** Where presets go when not given: BambuStudio's current preset folder and printer, else "default" and DEFAULT_PRINTER. */
export async function bambuDefaults(
  configDir: string = bambuConfigDir(),
): Promise<{ presetFolder: string; printer: string }> {
  const conf = await readBambuStudioConf(configDir);
  return { presetFolder: conf.presetFolder ?? "default", printer: conf.printer ?? DEFAULT_PRINTER };
}
