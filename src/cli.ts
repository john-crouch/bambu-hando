// ABOUTME: Headless CLI for the BambuStudio + SpoolEase filament handoff flow.
// ABOUTME: Parses flags, runs the sync, prints a JSON report, and maps outcomes to exit codes.

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { resultFailed, type SyncResult } from "./models.js";
import type { PresetOutcome } from "./bambuStudio.js";
import { loadProfiles } from "./sources.js";
import type { SpoolEaseConnection } from "./spoolease.js";
import { KeyCheckError, runSync } from "./sync.js";
import type { FormValues } from "./tui/App.js";

export const DEFAULT_PRINTER_PRESET = "Bambu Lab X1C 0.4 nozzle";

const USAGE = `Usage:
  bambu-hando --source <file|url> [options]
  bambu-hando tui [options]

Sync filament profiles into BambuStudio custom presets and SpoolEase.
The tui command opens an interactive terminal UI; its options prefill the
setup form (--dry-run and --report are headless only).

Options:
  --source <file|url>             JSON file or URL with filament profiles (required)
  --preset-folder <name>          BambuStudio user preset folder (default: default)
  --printer-preset <name>         Printer preset suffix (default: ${DEFAULT_PRINTER_PRESET})
  --dry-run                       Plan operations without writing
  --spoolease-host <host>         SpoolEase console host or IP (env: SPOOLEASE_HOST)
  --spoolease-security-key <key>  SpoolEase security key (env: SPOOLEASE_SECURITY_KEY)
  --spoolease-port <port>         SpoolEase port (default: 80)
  --spoolease-https               Use HTTPS for SpoolEase
  --skip-spoolease                Skip SpoolEase API updates
  --report <path>                 Also write the JSON report to this path
  -h, --help                      Show this help

Exit codes: 0 success, 1 a profile failed, 2 invalid arguments or SpoolEase key check failed.
`;

const OPTIONS = {
  source: { type: "string" },
  "preset-folder": { type: "string", default: "default" },
  "printer-preset": { type: "string", default: DEFAULT_PRINTER_PRESET },
  "dry-run": { type: "boolean", default: false },
  "spoolease-host": { type: "string" },
  "spoolease-security-key": { type: "string" },
  "spoolease-port": { type: "string", default: "80" },
  "spoolease-https": { type: "boolean", default: false },
  "skip-spoolease": { type: "boolean", default: false },
  report: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
} as const;

const { "dry-run": _dryRun, report: _report, ...TUI_OPTIONS } = OPTIONS;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

class UsageError extends Error {}

export interface Settings {
  source: string;
  presetFolder: string;
  printerPreset: string;
  dryRun: boolean;
  spoolease: SpoolEaseConnection | null;
  report: string;
}

function parseSettings(argv: string[]): { settings: Settings | null; help: boolean } {
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

  const port = Number(values["spoolease-port"]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new UsageError("--spoolease-port must be a port number");

  let spoolease: SpoolEaseConnection | null = null;
  if (!values["skip-spoolease"]) {
    const host = values["spoolease-host"] || process.env.SPOOLEASE_HOST || "";
    const securityKey = values["spoolease-security-key"] || process.env.SPOOLEASE_SECURITY_KEY || "";
    if (!host || !securityKey) {
      throw new UsageError("SpoolEase host and security key are required unless --skip-spoolease is set");
    }
    spoolease = { host, securityKey, port, https: values["spoolease-https"] };
  }

  return {
    help: false,
    settings: {
      source: values.source,
      presetFolder: values["preset-folder"],
      printerPreset: values["printer-preset"],
      dryRun: values["dry-run"],
      spoolease,
      report: values.report ?? "",
    },
  };
}

export function buildReport(source: string, dryRun: boolean, presets: PresetOutcome[], results: SyncResult[]): string {
  const report = {
    source,
    dry_run: dryRun,
    profiles_count: results.length,
    bambu_preset_paths: presets.map((p) => p.path),
    results: results.map((r) => ({
      profile_name: r.profileName,
      bambu_status: r.bambuStatus,
      spoolease_status: r.spooleaseStatus,
      detail: r.detail,
    })),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

function parseTuiValues(argv: string[]): { values: FormValues | null; help: boolean } {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: TUI_OPTIONS, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values } = parsed;
  if (values.help) return { values: null, help: true };
  if (!process.stdin.isTTY) throw new UsageError("bambu-hando tui needs an interactive terminal");

  return {
    help: false,
    values: {
      source: values.source ?? "",
      presetFolder: values["preset-folder"],
      printerPreset: values["printer-preset"],
      host: values["spoolease-host"] || process.env.SPOOLEASE_HOST || "",
      port: values["spoolease-port"],
      securityKey: values["spoolease-security-key"] || process.env.SPOOLEASE_SECURITY_KEY || "",
      https: values["spoolease-https"],
      skipSpoolease: values["skip-spoolease"],
    },
  };
}

async function tuiCommand(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseTuiValues(argv);
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
    parsed = parseSettings(argv);
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
    const profiles = await loadProfiles(settings.source);
    const { presets, results } = await runSync({ ...settings, profiles }, (event) => {
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
    io.stderr(`bambu-hando: error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
