// ABOUTME: Headless CLI for the BambuStudio + SpoolEase filament handoff flow.
// ABOUTME: Parses flags, runs the sync, prints a JSON report, and maps outcomes to exit codes.

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { bambuDefaults } from "./bambuProfiles.js";
import type { PresetOutcome } from "./bambuStudio.js";
import { type FilamentProfile, resultFailed, type SyncResult } from "./models.js";
import { loadProfiles } from "./sources.js";
import { SpoolEaseClient, type SpoolEaseConnection } from "./spoolease.js";
import { readSpoolEaseConfig } from "./spooleaseConfig.js";
import {
  applyWeights,
  defaultChoice,
  describeSourceWeights,
  parseSpoolWeightArg,
  readSpoolWeights,
  type WeightChoice,
  weightGroups,
} from "./spoolWeights.js";
import { filterProfiles, loadSpoolmanDb, type ProfileFilters, SPOOLMANDB_SOURCE } from "./spoolmanDb.js";
import { checkKey, KeyCheckError, runSync, SetupError } from "./sync.js";
import type { FormValues } from "./tui/App.js";

const USAGE = `Usage:
  bambu-hando --source <file|url|spoolmandb> [options]
  bambu-hando tui [options]

Sync filament profiles into BambuStudio custom presets and SpoolEase.
The tui command opens an interactive terminal UI; its options prefill the
setup form (--dry-run and --report are headless only), and the SpoolmanDB
filters prefill the filament search.

Options:
  --source <file|url|spoolmandb>  JSON file or URL with filament profiles, or spoolmandb
                                  for the SpoolmanDB community database (required)
  --preset-folder <name>          BambuStudio user preset folder (default: the logged-in
                                  user's folder from BambuStudio.conf, else default)
  --printer-preset <name>         BambuStudio printer, e.g. "Bambu Lab X1 Carbon 0.4 nozzle";
                                  repeat for several (default: the printer selected in BambuStudio)
  --overwrite-presets             Replace BambuStudio presets that already exist (by default
                                  they are kept, so tuning done in BambuStudio survives)
  --dry-run                       Plan operations without writing
  --spoolease-host <host>         SpoolEase console host or IP (env: SPOOLEASE_HOST)
  --spoolease-security-key <key>  SpoolEase security key (env: SPOOLEASE_SECURITY_KEY)
                                  Both default to the SpoolEase settings saved in BambuStudio
  --spoolease-port <port>         SpoolEase port (default: 80)
  --spoolease-https               Use HTTPS for SpoolEase
  --skip-spoolease                Skip SpoolEase API updates
  --skip-spools                   Register filaments in SpoolEase without creating spools
                                  (by default each filament without a spool gets one)
  --spool-weight <brand>=<value>  Empty spool weight for a brand's new spools: grams,
                                  spoolmandb or unspecified (SpoolEase then works it out
                                  when the full spool is first weighed); repeat per brand.
                                  A brand with one row in SpoolEase's spool catalog gets
                                  that weight; one with several needs this flag; others
                                  keep SpoolmanDB's
  --report <path>                 Also write the JSON report to this path
  -h, --help                      Show this help

SpoolmanDB filters (--source spoolmandb needs at least one of the first three):
  --brand <name>                  Manufacturer, e.g. Polymaker (ignores case)
  --material <type>               Material, e.g. PETG (ignores case)
  --match <words>                 Words that must all appear in the filament name
  --diameter <mm>                 Filament diameter (default: 1.75)

Exit codes: 0 success, 1 a profile failed, 2 invalid arguments, BambuStudio not set up,
or SpoolEase key check failed.
`;

const OPTIONS = {
  source: { type: "string" },
  "preset-folder": { type: "string" },
  "printer-preset": { type: "string", multiple: true },
  "overwrite-presets": { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  "spoolease-host": { type: "string" },
  "spoolease-security-key": { type: "string" },
  "spoolease-port": { type: "string", default: "80" },
  "spoolease-https": { type: "boolean", default: false },
  "skip-spoolease": { type: "boolean", default: false },
  "skip-spools": { type: "boolean", default: false },
  "spool-weight": { type: "string", multiple: true },
  report: { type: "string" },
  brand: { type: "string" },
  material: { type: "string" },
  match: { type: "string" },
  diameter: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
} as const;

const { "dry-run": _dryRun, report: _report, "spool-weight": _spoolWeight, ...TUI_OPTIONS } = OPTIONS;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

class UsageError extends Error {}

function parseDiameter(value: string | undefined): number {
  const diameter = Number(value ?? "1.75");
  if (!Number.isFinite(diameter) || diameter <= 0) throw new UsageError("--diameter must be a positive number");
  return diameter;
}

export interface SpoolmanDbSelection extends ProfileFilters {
  diameter: number;
}

export interface Settings {
  source: string;
  /** Set when --source is spoolmandb. */
  spoolmanDb: SpoolmanDbSelection | null;
  /** null: BambuStudio's current preset folder. */
  presetFolder: string | null;
  /** Empty: the printer selected in BambuStudio. */
  printers: string[];
  overwritePresets: boolean;
  dryRun: boolean;
  spoolease: SpoolEaseConnection | null;
  createSpools: boolean;
  /** --spool-weight choices by brand key. */
  spoolWeights: Map<string, { brand: string; arg: string; choice: WeightChoice }>;
  report: string;
}

async function parseSettings(argv: string[]): Promise<{ settings: Settings | null; help: boolean }> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;

  if (values.help) return { settings: null, help: true };
  if (positionals.length > 0) throw new UsageError(`unknown command '${positionals[0]}'`);
  if (!values.source) throw new UsageError("--source is required");

  let spoolmanDb: SpoolmanDbSelection | null = null;
  const filters = { brand: values.brand ?? "", material: values.material ?? "", match: values.match ?? "" };
  if (values.source === SPOOLMANDB_SOURCE) {
    if (!filters.brand && !filters.material && !filters.match) {
      throw new UsageError("--source spoolmandb needs at least one of --brand, --material, --match");
    }
    spoolmanDb = { ...filters, diameter: parseDiameter(values.diameter) };
  } else if (filters.brand || filters.material || filters.match || values.diameter !== undefined) {
    throw new UsageError("--brand, --material, --match and --diameter only apply to --source spoolmandb");
  }

  const port = Number(values["spoolease-port"]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new UsageError("--spoolease-port must be a port number");

  let spoolease: SpoolEaseConnection | null = null;
  if (!values["skip-spoolease"]) {
    const saved = await readSpoolEaseConfig();
    const host = values["spoolease-host"] || process.env.SPOOLEASE_HOST || saved.host || "";
    const securityKey = values["spoolease-security-key"] || process.env.SPOOLEASE_SECURITY_KEY || saved.securityKey || "";
    if (!host || !securityKey) {
      throw new UsageError(
        "SpoolEase host and security key are required unless --skip-spoolease is set: pass --spoolease-host and --spoolease-security-key, set SPOOLEASE_HOST and SPOOLEASE_SECURITY_KEY, or configure SpoolEase in BambuStudio",
      );
    }
    spoolease = { host, securityKey, port, https: values["spoolease-https"] };
  }

  const createSpools = !values["skip-spools"];
  const spoolWeights: Settings["spoolWeights"] = new Map();
  for (const arg of values["spool-weight"] ?? []) {
    let parsed;
    try {
      parsed = parseSpoolWeightArg(arg);
    } catch (err) {
      throw new UsageError(err instanceof Error ? err.message : String(err));
    }
    spoolWeights.set(parsed.key, { brand: parsed.brand, arg, choice: parsed.choice });
  }
  if (spoolWeights.size > 0 && (!spoolease || !createSpools)) {
    throw new UsageError("--spool-weight only applies when SpoolEase spools are created");
  }

  return {
    help: false,
    settings: {
      source: values.source,
      spoolmanDb,
      presetFolder: values["preset-folder"] ?? null,
      printers: values["printer-preset"] ?? [],
      overwritePresets: values["overwrite-presets"],
      dryRun: values["dry-run"],
      spoolease,
      createSpools,
      spoolWeights,
      report: values.report ?? "",
    },
  };
}

export function buildReport(source: string, dryRun: boolean, presets: PresetOutcome[], results: SyncResult[]): string {
  const report = {
    source,
    dry_run: dryRun,
    profiles_count: results.length,
    bambu_preset_paths: presets.flatMap((p) => p.paths),
    results: results.map((r) => ({
      profile_name: r.profileName,
      filament_id: r.filamentId,
      bambu_status: r.bambuStatus,
      spoolease_status: r.spooleaseStatus,
      detail: r.detail,
    })),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Profiles with the empty spool weights from SpoolEase's catalog and --spool-weight, or null after
 * telling the user which brands need a --spool-weight.
 */
async function chooseSpoolWeights(
  profiles: FilamentProfile[],
  spoolease: SpoolEaseConnection,
  chosen: Settings["spoolWeights"],
  io: Io,
): Promise<FilamentProfile[] | null> {
  // A wrong key would otherwise surface as an unreadable My Spools List.
  const client = new SpoolEaseClient(spoolease);
  await checkKey(client);
  const { entries, warnings } = await readSpoolWeights(client);
  for (const warning of warnings) io.stderr(`${warning}\n`);
  const groups = weightGroups(profiles, entries);

  for (const [key, { brand, arg }] of chosen) {
    if (!groups.some((g) => g.key === key)) {
      io.stderr(`bambu-hando: error: --spool-weight "${arg}": none of the filaments is from ${brand}\n`);
      return null;
    }
  }

  const open = groups.filter((g) => !chosen.has(g.key) && defaultChoice(g) === null);
  if (open.length > 0) {
    const lines = ["bambu-hando: error: SpoolEase lists several empty spool weights for these brands; run again with the --spool-weight you want:"];
    for (const group of open) {
      const count = group.profiles.length;
      lines.push(`  ${group.brand} (${count} filament${count === 1 ? "" : "s"}; SpoolmanDB: ${describeSourceWeights(profiles, group)})`);
      const flags = group.options.map((o) => `--spool-weight "${group.brand}=${o.grams}"`);
      const width = Math.max(...flags.map((f) => f.length));
      group.options.forEach((option, i) => {
        lines.push(`    ${flags[i]!.padEnd(width)}  ${option.label}${option.mine ? " (My Spools List)" : ""}`);
      });
    }
    io.stderr(`${lines.join("\n")}\n`);
    return null;
  }

  for (const group of groups) {
    const [only] = group.options;
    if (!chosen.has(group.key) && only && group.options.length === 1) {
      io.stderr(`${group.brand}: empty spool weight ${only.grams} g from SpoolEase (${only.label})\n`);
    }
  }
  return applyWeights(profiles, groups, new Map([...chosen].map(([key, { choice }]) => [key, choice])));
}

async function parseTuiValues(argv: string[]): Promise<{ values: FormValues | null; help: boolean }> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: TUI_OPTIONS, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values } = parsed;
  if (values.help) return { values: null, help: true };
  if (!process.stdin.isTTY) throw new UsageError("bambu-hando tui needs an interactive terminal");
  const defaults = await bambuDefaults();
  const saved = await readSpoolEaseConfig();

  return {
    help: false,
    values: {
      source: values.source ?? "",
      presetFolder: values["preset-folder"] ?? defaults.presetFolder,
      printerPreset: (values["printer-preset"] ?? [defaults.printer]).join(", "),
      overwritePresets: values["overwrite-presets"],
      host: values["spoolease-host"] || process.env.SPOOLEASE_HOST || saved.host || "",
      port: values["spoolease-port"],
      securityKey: values["spoolease-security-key"] || process.env.SPOOLEASE_SECURITY_KEY || saved.securityKey || "",
      https: values["spoolease-https"],
      skipSpoolease: values["skip-spoolease"],
      createSpools: !values["skip-spools"],
      query: [values.brand, values.material, values.match].filter(Boolean).join(" "),
      diameter: parseDiameter(values.diameter),
    },
  };
}

async function tuiCommand(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = await parseTuiValues(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`bambu-hando: error: ${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.help || !parsed.values) {
    io.stdout(USAGE);
    return 0;
  }
  const { runTui } = await import("./tui/run.js");
  return runTui(parsed.values);
}

export async function main(argv: string[], io: Io = processIo): Promise<number> {
  if (argv[0] === "tui") return tuiCommand(argv.slice(1), io);

  let parsed;
  try {
    parsed = await parseSettings(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`bambu-hando: error: ${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.help || !parsed.settings) {
    io.stdout(USAGE);
    return 0;
  }
  const settings = parsed.settings;

  try {
    let profiles: FilamentProfile[];
    if (settings.spoolmanDb) {
      const catalog = await loadSpoolmanDb({ diameter: settings.spoolmanDb.diameter });
      for (const warning of catalog.warnings) io.stderr(`${warning}\n`);
      profiles = filterProfiles(catalog.profiles, settings.spoolmanDb);
      if (profiles.length === 0) {
        io.stderr(
          "bambu-hando: error: no SpoolmanDB filaments match the filters (Bambu Lab filaments are never included: BambuStudio ships its own presets for them)\n",
        );
        return 2;
      }
    } else {
      profiles = await loadProfiles(settings.source);
    }
    if (settings.spoolease && settings.createSpools) {
      const weighed = await chooseSpoolWeights(profiles, settings.spoolease, settings.spoolWeights, io);
      if (!weighed) return 2;
      profiles = weighed;
    }
    const defaults = await bambuDefaults();
    const target = {
      presetFolder: settings.presetFolder ?? defaults.presetFolder,
      printers: settings.printers.length ? settings.printers : [defaults.printer],
    };
    const { presets, results } = await runSync({ ...settings, ...target, profiles }, (event) => {
      if (event.type === "warning") io.stderr(`${event.message}\n`);
    });

    const report = buildReport(settings.source, settings.dryRun, presets, results);
    io.stdout(report);
    if (settings.report) await writeFile(settings.report, report, "utf-8");

    return results.some(resultFailed) ? 1 : 0;
  } catch (err) {
    if (err instanceof KeyCheckError) {
      io.stderr(`${err.message}\n`);
      return 2;
    }
    if (err instanceof SetupError) {
      io.stderr(`bambu-hando: error: ${err.message}\n`);
      return 2;
    }
    io.stderr(`bambu-hando: error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
