// ABOUTME: Headless CLI for the BambuStudio + SpoolEase filament handoff flow.
// ABOUTME: Parses flags, runs the sync, prints a JSON report, and maps outcomes to exit codes.

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { bambuDefaults } from "./bambuProfiles.js";
import type { PresetOutcome } from "./bambuStudio.js";
import { askYesNo } from "./confirm.js";
import { errorMessage } from "./errors.js";
import { filamentProfilesCommand } from "./filamentProfilesCommand.js";
import { keyCommand } from "./keyCommand.js";
import { LabelSelectionError, type LabelTarget, makeLabels } from "./labelJob.js";
import {
  DEFAULT_LABEL_FIELDS,
  DEFAULT_LABEL_SIZE,
  describeSpool,
  LABEL_FIELDS,
  type LabelField,
  type LabelSize,
  parseLabelFields,
  parseLabelSize,
  type SpoolFilters,
} from "./labels.js";
import { type FilamentProfile, resultFailed, type Status, type SyncResult } from "./models.js";
import type { SecretInput } from "./secretPrompt.js";
import { InvalidSecretError } from "./secrets.js";
import { loadProfiles } from "./sources.js";
import { SpoolEaseClient, type SpoolEaseConnection } from "./spoolease.js";
import {
  type ConsoleSettings,
  consoleSettings,
  SPOOLEASE_SETTINGS_HINT,
  type SpoolEaseFlags,
  spooleaseConnectionFrom,
} from "./spooleaseConfig.js";
import {
  filterProfiles,
  loadSpoolmanDb,
  type ProfileFilters,
  SPOOLMANDB_SOURCE,
} from "./spoolmanDb.js";
import {
  applyWeights,
  defaultChoice,
  describeSourceWeights,
  parseSpoolWeightArg,
  readSpoolWeights,
  type WeightChoice,
  weightGroups,
} from "./spoolWeights.js";
import { checkKey, KeyCheckError, runSync, SetupError } from "./sync.js";
import { checkCounts, checkLines, checkSummary, readCheck } from "./syncCheck.js";
import type { FormValues } from "./tui/core/values.js";
import { loadTuiSettings } from "./tuiSettings.js";

/** Headless SpoolmanDB runs sync at most this many filaments unless --max-filaments says otherwise. */
const DEFAULT_MAX_FILAMENTS = 10;

const USAGE = `Usage:
  bambu-hando --source <file|url|spoolmandb> [options]
  bambu-hando tui [options]
  bambu-hando labels [options]
  bambu-hando check [options]
  bambu-hando key <set|status|remove> [name]
  bambu-hando 3dfp <usage|spools> [options]

Sync filament profiles into BambuStudio custom presets and SpoolEase.
The tui command opens an interactive terminal UI; its options prefill the
setup form (--dry-run, --report and --max-filaments are headless only), and
the SpoolmanDB filters prefill the filament search. The labels command makes
QR spool labels for SpoolEase spools (bambu-hando labels --help). The check
command reports what doesn't line up between BambuStudio and SpoolEase
(bambu-hando check --help). The key command keeps API keys in the system
keyring (bambu-hando key --help); the 3dfp command reads your 3DFilamentProfiles
spools and API quota (bambu-hando 3dfp --help).

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
                                  Both default to the console saved in the TUI's
                                  Settings (its key in the system keyring, also
                                  stored by bambu-hando key set spoolease), then
                                  to the SpoolEase settings saved in BambuStudio
  --spoolease-port <port>         SpoolEase port (default: as saved in Settings, else 80)
  --spoolease-https               Use HTTPS for SpoolEase (default: as saved in Settings;
                                  --no-spoolease-https turns a saved one off)
  --skip-spoolease                Skip SpoolEase API updates
  --skip-spools                   Register filaments in SpoolEase without creating spools
                                  (by default each filament without a spool gets one)
  --spool-weight <brand>=<value>  Empty spool weight for a brand's new spools: grams,
                                  spoolmandb or unspecified (SpoolEase then works it out
                                  when the full spool is first weighed); repeat per brand.
                                  A brand with one row in SpoolEase's spool catalog gets
                                  that weight; one with several needs this flag; others
                                  keep SpoolmanDB's
  --label-output <file.pdf>       Write QR labels for the spools this run creates to a PDF
  --label-printer <name>          Print those labels with CUPS (lp); see bambu-hando labels --help
  --label-fields <list>           Label fields (default: ${DEFAULT_LABEL_FIELDS.join(",")})
  --label-size <W>x<H>[in|mm]     Label size (default: ${DEFAULT_LABEL_SIZE})
  --report <path>                 Also write the JSON report to this path
  -h, --help                      Show this help

SpoolmanDB filters (--source spoolmandb needs at least one of the first three):
  --brand <name>                  Manufacturer, e.g. Polymaker (ignores case)
  --material <type>               Material, e.g. PETG (ignores case)
  --match <words>                 Words that must all appear in the filament name
  --diameter <mm>                 Filament diameter (default: 1.75)
  --max-filaments <n>             Most filaments a run may sync (default: ${DEFAULT_MAX_FILAMENTS}); more matches
                                  exit 2 before anything is written. --dry-run is not capped

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
  "spoolease-port": { type: "string" },
  "spoolease-https": { type: "boolean" },
  "skip-spoolease": { type: "boolean", default: false },
  "skip-spools": { type: "boolean", default: false },
  "spool-weight": { type: "string", multiple: true },
  "label-output": { type: "string" },
  "label-printer": { type: "string" },
  "label-fields": { type: "string" },
  "label-size": { type: "string" },
  report: { type: "string" },
  brand: { type: "string" },
  material: { type: "string" },
  match: { type: "string" },
  diameter: { type: "string" },
  "max-filaments": { type: "string" },
  help: { type: "boolean", short: "h", default: false },
} as const;

const {
  "dry-run": _dryRun,
  "max-filaments": _maxFilaments,
  report: _report,
  "spool-weight": _spoolWeight,
  "label-output": _labelOutput,
  "label-printer": _labelPrinter,
  "label-fields": _labelFields,
  "label-size": _labelSize,
  ...TUI_OPTIONS
} = OPTIONS;

const TUI_USAGE = `Usage: bambu-hando tui [options]

Opens the full-screen terminal UI: your spools on the SpoolEase console, adding
filaments from SpoolmanDB or a file, your BambuStudio presets, the sync check
and settings. Nothing is written until you confirm it on a review page or in a
dialog that names every target.

Options (each one prefills Settings for this session):
  --source <file|url>             Filaments to add from a JSON file or URL
                                  (default: SpoolmanDB)
  --preset-folder <name>          BambuStudio user preset folder
  --printer-preset <name>         BambuStudio printer; repeat for several
  --overwrite-presets             Replace BambuStudio presets that already exist
  --spoolease-host <host>         SpoolEase console (env: SPOOLEASE_HOST)
  --spoolease-security-key <key>  Its security key (env: SPOOLEASE_SECURITY_KEY)
  --spoolease-port <port>         SpoolEase port (default: 80)
  --spoolease-https               Use HTTPS (--no-spoolease-https: don't)
                                  Without these: the console saved in Settings
                                  (its key in the system keyring, also stored
                                  by bambu-hando key set spoolease), then the
                                  SpoolEase settings saved in BambuStudio
  --skip-spoolease                Leave SpoolEase out
  --skip-spools                   Don't create a spool for each new filament
  --brand, --material, --match    Open Add searching for these
  --diameter <mm>                 Filament diameter (default: 1.75)
  -h, --help                      Show this help

Keys:
  tab  shift+tab   next and previous tab (Spools Add Presets Check Settings)
  ←→               pages inside a tab
  ↑↓  enter  esc   move, open or choose, back
  space  /  a      tick, filter, apply on a review
  ?  ctrl+k        help for where you are, find a command by name
  q  ctrl+c        quit (asks first if there are unsaved changes), quit now

Exit codes: 0 every run went well, 1 a run failed, 2 a setup error, 130 ctrl+c.
`;

const LABELS_USAGE = `Usage:
  bambu-hando labels (--spool-id <id>... | --brand/--material/--match | --all)
                     (--output <file.pdf> | --printer <name>) [options]

Make spool labels for SpoolEase spools: a PDF with one page per label, sized
to the label, so any printer can print it. Each QR code holds SpoolEase's own
link for the spool, with its ID.

Spools:
  --spool-id <id>                 SpoolEase spool ID; repeat for several (labels follow this order)
  --brand <name>                  Spools of this brand (ignores case)
  --material <type>               Spools of this material (ignores case)
  --match <words>                 Words that must all appear in the spool's brand, material,
                                  color or filament name
  --all                           Every spool

Label:
  --fields <list>                 Comma-separated fields to show (default: ${DEFAULT_LABEL_FIELDS.join(",")})
  --size <W>x<H>[in|mm]           Label size (default: ${DEFAULT_LABEL_SIZE}, the common 2.25x1.25in roll)

Output:
  --output <file.pdf>             Write the labels to this PDF
  --printer <name>                Print with CUPS (lp), asking for the label's media size
  --print-option <key=value>      Extra lp option, e.g. Darkness=14; repeat for several

SpoolEase (default: the console saved in the TUI's Settings, its key kept there
or by bambu-hando key set spoolease, then the SpoolEase settings saved in
BambuStudio):
  --spoolease-host <host>         Console host or IP (env: SPOOLEASE_HOST)
  --spoolease-security-key <key>  Security key (env: SPOOLEASE_SECURITY_KEY)
  --spoolease-port <port>         Port (default: as saved in Settings, else 80)
  --spoolease-https               Use HTTPS (--no-spoolease-https: don't, even if saved)
  -h, --help                      Show this help

Fields (shown in this order):
${LABEL_FIELDS.map((f) => `  ${f.key.padEnd(10)}${f.description}`).join("\n")}

Exit codes: 0 success, 1 printing or another step failed, 2 invalid arguments, no matching
spools, or SpoolEase key check failed.
`;

const LABEL_OPTIONS = {
  "spool-id": { type: "string", multiple: true },
  brand: { type: "string" },
  material: { type: "string" },
  match: { type: "string" },
  all: { type: "boolean", default: false },
  fields: { type: "string" },
  size: { type: "string", default: DEFAULT_LABEL_SIZE },
  output: { type: "string" },
  printer: { type: "string" },
  "print-option": { type: "string", multiple: true },
  "spoolease-host": { type: "string" },
  "spoolease-security-key": { type: "string" },
  "spoolease-port": { type: "string" },
  "spoolease-https": { type: "boolean" },
  help: { type: "boolean", short: "h", default: false },
} as const;

const CHECK_USAGE = `Usage:
  bambu-hando check [--json] [options]

Check that BambuStudio's presets, SpoolEase's custom filaments and its spools
line up: problems (a spool that finds no preset in the AMS, a custom filament
row SpoolEase misreads) and notes (presets SpoolEase doesn't know, spools
without a filament). Reads only; changes nothing.

Options:
  --preset-folder <name>          BambuStudio user preset folder (default: the logged-in
                                  user's folder from BambuStudio.conf, else default)
  --json                          Print a snake_case JSON report instead of text
  --spoolease-host <host>         Console host or IP (env: SPOOLEASE_HOST)
  --spoolease-security-key <key>  Security key (env: SPOOLEASE_SECURITY_KEY)
  --spoolease-port <port>         Port (default: as saved in Settings, else 80)
  --spoolease-https               Use HTTPS (--no-spoolease-https: don't, even if saved)
  -h, --help                      Show this help

SpoolEase defaults to the console saved in the TUI's Settings (its key kept there
or by bambu-hando key set spoolease), then to the SpoolEase settings saved in
BambuStudio.

Exit codes: 0 no problems (notes don't count), 1 problems or a failed read,
2 invalid arguments or SpoolEase key check failed.
`;

const CHECK_OPTIONS = {
  "preset-folder": { type: "string" },
  json: { type: "boolean", default: false },
  "spoolease-host": { type: "string" },
  "spoolease-security-key": { type: "string" },
  "spoolease-port": { type: "string" },
  "spoolease-https": { type: "boolean" },
  help: { type: "boolean", short: "h", default: false },
} as const;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Where `key set` reads a key from; process.stdin when absent. */
  stdin?: SecretInput;
  /** Asks `3dfp sync`'s yes/no question; a terminal prompt on stdin when absent. */
  confirm?: (question: string) => Promise<boolean | null>;
}

const processIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

class UsageError extends Error {}

/** Runs an argument parser, reporting whatever it throws as a usage error. */
function asUsage<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}

const LISTED_MATCHES = 10;

function tooManyMatches(profiles: FilamentProfile[], maxFilaments: number): string {
  const listed = profiles.slice(0, LISTED_MATCHES).map((p) => `  ${p.name}`);
  const more = profiles.length - listed.length;
  return [
    `bambu-hando: error: ${profiles.length} SpoolmanDB filaments match the filters, more than --max-filaments (${maxFilaments}):`,
    ...listed,
    ...(more > 0 ? [`  ...and ${more} more`] : []),
    `Narrow the filters (for example with --match), or pass --max-filaments ${profiles.length} to sync them all; --dry-run lists every match.`,
    "",
  ].join("\n");
}

function parseDiameter(value: string | undefined): number {
  const diameter = Number(value ?? "1.75");
  if (!Number.isFinite(diameter) || diameter <= 0)
    throw new UsageError("--diameter must be a positive number");
  return diameter;
}

function parseMaxFilaments(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MAX_FILAMENTS;
  const max = Number(value);
  if (!/^\d+$/.test(value) || max < 1)
    throw new UsageError("--max-filaments must be a whole number of at least 1");
  return max;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new UsageError("--spoolease-port must be a port number");
  return port;
}

/** consoleSettings, with an unusable saved key as a usage error (which never quotes it). */
async function consoleOrUsage(flags: SpoolEaseFlags): Promise<ConsoleSettings> {
  try {
    return await consoleSettings(flags);
  } catch (err) {
    throw err instanceof InvalidSecretError ? new UsageError(err.message) : err;
  }
}

/** The console to talk to; a usage error without both a host and a key. */
async function spooleaseConnection(
  values: SpoolEaseFlags,
  unless = "",
): Promise<SpoolEaseConnection> {
  const settings = await consoleOrUsage(values);
  const connection = spooleaseConnectionFrom(settings, parsePort(settings.port));
  if (!connection)
    throw new UsageError(
      `SpoolEase host and security key are required${unless}: ${SPOOLEASE_SETTINGS_HINT}`,
    );
  return connection;
}

export interface SpoolmanDbSelection extends ProfileFilters {
  diameter: number;
  /** Most matching filaments a run may sync (dry runs are not capped). */
  maxFilaments: number;
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
  /** Labels for the spools the run creates; null when none were asked for. */
  labels: LabelTarget | null;
  report: string;
}

async function parseSettings(
  argv: string[],
): Promise<{ settings: Settings | null; help: boolean }> {
  const { values, positionals } = asUsage(() =>
    parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      allowNegative: true,
      strict: true,
    }),
  );

  if (values.help) return { settings: null, help: true };
  if (positionals.length > 0) throw new UsageError(`unknown command '${positionals[0]}'`);
  if (!values.source) throw new UsageError("--source is required");

  let spoolmanDb: SpoolmanDbSelection | null = null;
  const filters = {
    brand: values.brand ?? "",
    material: values.material ?? "",
    match: values.match ?? "",
  };
  if (values.source === SPOOLMANDB_SOURCE) {
    if (!filters.brand && !filters.material && !filters.match) {
      throw new UsageError(
        "--source spoolmandb needs at least one of --brand, --material, --match",
      );
    }
    spoolmanDb = {
      ...filters,
      diameter: parseDiameter(values.diameter),
      maxFilaments: parseMaxFilaments(values["max-filaments"]),
    };
  } else if (
    filters.brand ||
    filters.material ||
    filters.match ||
    values.diameter !== undefined ||
    values["max-filaments"] !== undefined
  ) {
    throw new UsageError(
      "--brand, --material, --match, --diameter and --max-filaments only apply to --source spoolmandb",
    );
  }

  if (values["spoolease-port"] !== undefined) parsePort(values["spoolease-port"]);
  const spoolease = values["skip-spoolease"]
    ? null
    : await spooleaseConnection(values, " unless --skip-spoolease is set");

  const createSpools = !values["skip-spools"];
  const spoolWeights: Settings["spoolWeights"] = new Map();
  for (const arg of values["spool-weight"] ?? []) {
    const parsed = asUsage(() => parseSpoolWeightArg(arg));
    spoolWeights.set(parsed.key, { brand: parsed.brand, arg, choice: parsed.choice });
  }
  if (spoolWeights.size > 0 && (!spoolease || !createSpools)) {
    throw new UsageError("--spool-weight only applies when SpoolEase spools are created");
  }

  let labels: LabelTarget | null = null;
  const labelOutput = values["label-output"] ?? "";
  const labelPrinter = values["label-printer"] ?? "";
  if (labelOutput || labelPrinter) {
    if (!spoolease || !createSpools)
      throw new UsageError(
        "--label-output and --label-printer only apply when SpoolEase spools are created",
      );
    try {
      const fields =
        values["label-fields"] === undefined
          ? DEFAULT_LABEL_FIELDS
          : parseLabelFields(values["label-fields"]);
      labels = {
        fields,
        size: parseLabelSize(values["label-size"] ?? DEFAULT_LABEL_SIZE),
        output: labelOutput,
        printer: labelPrinter,
        printOptions: [],
      };
    } catch (err) {
      throw new UsageError(err instanceof Error ? err.message : String(err));
    }
  } else if (values["label-fields"] !== undefined || values["label-size"] !== undefined) {
    throw new UsageError("--label-fields and --label-size need --label-output or --label-printer");
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
      labels,
      report: values.report ?? "",
    },
  };
}

/** What happened to the labels asked for alongside a sync. */
export interface LabelsReport {
  status: Status;
  spool_ids: string[];
  output: string | null;
  printer: string | null;
  detail: string;
}

export function buildReport(
  source: string,
  dryRun: boolean,
  presets: PresetOutcome[],
  results: SyncResult[],
  labels: LabelsReport | null = null,
): string {
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
      core_weight_g: r.coreWeight,
      spool_id: r.spoolId,
    })),
    labels,
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
  sourceName: string,
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
      io.stderr(
        `bambu-hando: error: --spool-weight "${arg}": none of the filaments is from ${brand}\n`,
      );
      return null;
    }
  }

  const open = groups.filter((g) => !chosen.has(g.key) && defaultChoice(g) === null);
  if (open.length > 0) {
    const lines = [
      "bambu-hando: error: SpoolEase lists several empty spool weights for these brands; run again with the --spool-weight you want:",
    ];
    for (const group of open) {
      const count = group.profiles.length;
      lines.push(
        `  ${group.brand} (${count} filament${count === 1 ? "" : "s"}; ${sourceName}: ${describeSourceWeights(profiles, group)})`,
      );
      const rows = group.options.map((option) => ({
        option,
        flag: `--spool-weight "${group.brand}=${option.grams}"`,
      }));
      const width = Math.max(...rows.map((r) => r.flag.length));
      for (const { option, flag } of rows) {
        lines.push(
          `    ${flag.padEnd(width)}  ${option.label}${option.mine ? " (My Spools List)" : ""}`,
        );
      }
    }
    io.stderr(`${lines.join("\n")}\n`);
    return null;
  }

  for (const group of groups) {
    const [only] = group.options;
    if (!chosen.has(group.key) && only && group.options.length === 1) {
      io.stderr(
        `${group.brand}: empty spool weight ${only.grams} g from SpoolEase (${only.label})\n`,
      );
    }
  }
  return applyWeights(
    profiles,
    groups,
    new Map([...chosen].map(([key, { choice }]) => [key, choice])),
  );
}

/** Labels for the spools a sync created; failures are reported, never thrown, since the sync itself is done. */
async function labelsAfterSync(
  target: LabelTarget,
  spoolease: SpoolEaseConnection,
  results: SyncResult[],
  dryRun: boolean,
  io: Io,
): Promise<LabelsReport> {
  const ids = results.map((r) => r.spoolId).filter((id): id is string => Boolean(id));
  const report = (status: Status, detail: string): LabelsReport => ({
    status,
    spool_ids: dryRun ? [] : ids,
    output: target.output || null,
    printer: target.printer || null,
    detail,
  });
  if (dryRun) return report("planned", "dry-run");
  if (ids.length === 0) return report("skipped", "no new spools");
  try {
    const made = await makeLabels(
      new SpoolEaseClient(spoolease),
      { ids, brand: "", material: "", match: "" },
      target,
      (w) => io.stderr(`${w}\n`),
    );
    if (made.printError) {
      io.stderr(`bambu-hando: error: ${made.printError}\n`);
      return report("failed", made.printError);
    }
    return report("written", made.printReply);
  } catch (err) {
    io.stderr(`bambu-hando: error: labels: ${errorMessage(err)}\n`);
    return report("failed", errorMessage(err));
  }
}

async function parseTuiValues(
  argv: string[],
): Promise<{ values: FormValues | null; help: boolean }> {
  const { values } = asUsage(() =>
    parseArgs({ args: argv, options: TUI_OPTIONS, allowNegative: true, strict: true }),
  );
  if (values.help) return { values: null, help: true };
  if (!process.stdin.isTTY) throw new UsageError("bambu-hando tui needs an interactive terminal");
  const [defaults, remembered, spoolease] = await Promise.all([
    bambuDefaults(),
    loadTuiSettings(),
    consoleOrUsage(values),
  ]);
  // --printer-preset, else the printers of the last TUI run, else the printer selected in BambuStudio.
  const printerList =
    values["printer-preset"] ??
    (remembered.printers.length ? remembered.printers : [defaults.printer]);

  return {
    help: false,
    values: {
      source: values.source ?? "",
      presetFolder: values["preset-folder"] ?? defaults.presetFolder,
      printerPreset: printerList.join(", "),
      overwritePresets: values["overwrite-presets"],
      host: spoolease.host,
      port: spoolease.port,
      securityKey: spoolease.securityKey,
      https: spoolease.https,
      skipSpoolease: values["skip-spoolease"],
      createSpools: !values["skip-spools"],
      query: [values.brand, values.material, values.match].filter(Boolean).join(" "),
      diameter: parseDiameter(values.diameter),
    },
  };
}

async function tuiCommand(argv: string[], io: Io): Promise<number> {
  let parsed: Awaited<ReturnType<typeof parseTuiValues>>;
  try {
    parsed = await parseTuiValues(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`bambu-hando: error: ${err.message}\n\n${TUI_USAGE}`);
    return 2;
  }
  if (parsed.help || !parsed.values) {
    io.stdout(TUI_USAGE);
    return 0;
  }
  const { runTui } = await import("./tui/run.js");
  return runTui(parsed.values);
}

interface LabelsSettings {
  filters: SpoolFilters;
  target: LabelTarget;
  spoolease: SpoolEaseConnection;
}

async function parseLabelsSettings(
  argv: string[],
): Promise<{ settings: LabelsSettings | null; help: boolean }> {
  const { values } = asUsage(() =>
    parseArgs({ args: argv, options: LABEL_OPTIONS, allowNegative: true, strict: true }),
  );
  if (values.help) return { settings: null, help: true };

  const filters = {
    ids: values["spool-id"] ?? [],
    brand: values.brand ?? "",
    material: values.material ?? "",
    match: values.match ?? "",
  };
  if (!values.all && !filters.ids.length && !filters.brand && !filters.material && !filters.match) {
    throw new UsageError("labels needs --spool-id, --brand, --material, --match or --all");
  }
  if (!values.output && !values.printer)
    throw new UsageError("labels needs --output, --printer or both");
  if (values["print-option"] && !values.printer)
    throw new UsageError("--print-option only applies with --printer");
  let size: LabelSize;
  let fields: LabelField[];
  try {
    size = parseLabelSize(values.size);
    fields = values.fields === undefined ? DEFAULT_LABEL_FIELDS : parseLabelFields(values.fields);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const spoolease = await spooleaseConnection(values);

  return {
    help: false,
    settings: {
      filters,
      target: {
        fields,
        size,
        output: values.output ?? "",
        printer: values.printer ?? "",
        printOptions: values["print-option"] ?? [],
      },
      spoolease,
    },
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

async function labelsCommand(argv: string[], io: Io): Promise<number> {
  let parsed: Awaited<ReturnType<typeof parseLabelsSettings>>;
  try {
    parsed = await parseLabelsSettings(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`bambu-hando: error: ${err.message}\n\n${LABELS_USAGE}`);
    return 2;
  }
  if (parsed.help || !parsed.settings) {
    io.stdout(LABELS_USAGE);
    return 0;
  }
  const { filters, target, spoolease } = parsed.settings;

  try {
    const client = new SpoolEaseClient(spoolease);
    await checkKey(client);
    const made = await makeLabels(client, filters, target, (warning) => io.stderr(`${warning}\n`));
    for (const spool of made.spools) io.stdout(`Spool #${spool.id}: ${describeSpool(spool)}\n`);
    const count = plural(made.spools.length, "label");
    if (target.output) io.stdout(`Wrote ${count} to ${target.output}\n`);
    if (made.printError) {
      io.stderr(`bambu-hando: error: ${made.printError}\n`);
      return 1;
    }
    if (target.printer)
      io.stdout(
        `Sent ${count} to ${target.printer}${made.printReply ? `: ${made.printReply}` : ""}\n`,
      );
    return 0;
  } catch (err) {
    if (err instanceof KeyCheckError) {
      io.stderr(`${err.message}\n`);
      return 2;
    }
    io.stderr(`bambu-hando: error: ${errorMessage(err)}\n`);
    return err instanceof LabelSelectionError ? 2 : 1;
  }
}

const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const parseCheckArgs = (argv: string[]) =>
  parseArgs({ args: argv, options: CHECK_OPTIONS, allowNegative: true, strict: true });

async function checkCommand(argv: string[], io: Io): Promise<number> {
  let values: ReturnType<typeof parseCheckArgs>["values"];
  let spoolease: SpoolEaseConnection;
  try {
    ({ values } = parseCheckArgs(argv));
    if (values.help) {
      io.stdout(CHECK_USAGE);
      return 0;
    }
    spoolease = await spooleaseConnection(values);
  } catch (err) {
    io.stderr(`bambu-hando: error: ${errorMessage(err)}\n\n${CHECK_USAGE}`);
    return 2;
  }

  try {
    const presetFolder = values["preset-folder"] ?? (await bambuDefaults()).presetFolder;
    const client = new SpoolEaseClient(spoolease);
    await checkKey(client);
    const { sections, warnings } = await readCheck(client, presetFolder);
    const counts = checkCounts(sections);
    const where = `${spoolease.host}:${spoolease.port}`;
    if (values.json) {
      const report = {
        preset_folder: presetFolder,
        spoolease: where,
        summary: counts,
        sections: sections.map((section) => ({
          key: snakeCase(section.key),
          title: section.title,
          problem: section.problem,
          items: section.items,
        })),
        warnings,
      };
      io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      for (const warning of warnings) io.stderr(`${warning}\n`);
      const lines = [
        `Sync check: BambuStudio ${presetFolder} · SpoolEase ${where}`,
        checkSummary(sections),
        "",
        ...checkLines(sections).map((line) => line.text),
      ];
      io.stdout(`${lines.join("\n")}\n`);
    }
    return counts.problems > 0 ? 1 : 0;
  } catch (err) {
    if (err instanceof KeyCheckError) {
      io.stderr(`${err.message}\n`);
      return 2;
    }
    io.stderr(`bambu-hando: error: ${errorMessage(err)}\n`);
    return 1;
  }
}

export async function main(argv: string[], io: Io = processIo): Promise<number> {
  if (argv[0] === "tui") return tuiCommand(argv.slice(1), io);
  if (argv[0] === "labels") return labelsCommand(argv.slice(1), io);
  if (argv[0] === "check") return checkCommand(argv.slice(1), io);
  if (argv[0] === "3dfp")
    return filamentProfilesCommand(argv.slice(1), {
      ...io,
      confirm: io.confirm ?? ((question) => askYesNo(question)),
    });
  if (argv[0] === "key")
    return keyCommand(argv.slice(1), { ...io, stdin: io.stdin ?? process.stdin });

  let parsed: Awaited<ReturnType<typeof parseSettings>>;
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
      const { maxFilaments } = settings.spoolmanDb;
      if (profiles.length > maxFilaments && !settings.dryRun) {
        io.stderr(tooManyMatches(profiles, maxFilaments));
        return 2;
      }
    } else {
      profiles = await loadProfiles(settings.source);
    }
    if (settings.spoolease && settings.createSpools) {
      const weighed = await chooseSpoolWeights(
        profiles,
        settings.spoolease,
        settings.spoolWeights,
        settings.spoolmanDb ? "SpoolmanDB" : "Source file",
        io,
      );
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

    const labels =
      settings.labels && settings.spoolease
        ? await labelsAfterSync(settings.labels, settings.spoolease, results, settings.dryRun, io)
        : null;

    const report = buildReport(settings.source, settings.dryRun, presets, results, labels);
    io.stdout(report);
    if (settings.report) await writeFile(settings.report, report, "utf-8");

    return results.some(resultFailed) || labels?.status === "failed" ? 1 : 0;
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
