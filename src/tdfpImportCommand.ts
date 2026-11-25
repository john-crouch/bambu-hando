// ABOUTME: `bambu-hando 3dfp import <code>…`: brings 3DFilamentProfiles spools into BambuStudio and SpoolEase and links them.
// ABOUTME: Shows what it would write first and asks (or takes --yes); exit 1 when a spool wasn't brought in, 2 for setup.

import { parseArgs } from "node:util";

import { QuotaError } from "./apiQuota.js";
import { bambuDefaults } from "./bambuProfiles.js";
import { errorMessage } from "./errors.js";
import { FilamentProfilesError, MAX_BULK_UPDATES } from "./filamentProfiles.js";
import {
  connectFilamentProfiles,
  type FilamentProfilesConnection,
  MissingKeyError,
} from "./filamentProfilesConnect.js";
import { tildePath } from "./paths.js";
import { holdsSecret, InvalidSecretError, KEY_ARGUMENT_ERROR } from "./secrets.js";
import {
  type ConsoleSettings,
  consoleSettings,
  SPOOLEASE_SETTINGS_HINT,
  spooleaseConnectionFrom,
} from "./spooleaseConfig.js";
import type { SyncIo } from "./spoolSyncCommand.js";
import { KeyCheckError } from "./sync.js";
import { applyImport } from "./tdfpImport.js";
import {
  importSettingsText,
  prepareFromApi,
  readImportBasis,
  saveImportLinks,
} from "./tdfpImportSession.js";
import { loadTuiSettings } from "./tuiSettings.js";

export const IMPORT_USAGE = `Usage: bambu-hando 3dfp import <short code>... [options]

Brings spools you keep on 3DFilamentProfiles into BambuStudio and SpoolEase: a preset per printer
and SpoolEase's custom-filament row for each filament (from its 3DFP record, with the spool's own
calibration first), a SpoolEase spool for each 3DFP spool, and a link between them. It shows what it
would write and asks first.

  --dry-run                  Show what it would write; change nothing
  --yes                      Import without asking
  --preset-folder <name>     BambuStudio preset folder (default: BambuStudio's)
  --printer-preset <name>    A printer to write presets for; repeat for several (default: the TUI's
                             last, else the printer selected in BambuStudio)
  --overwrite-presets        Replace presets that already exist
  --refresh                  Fetch the whole 3DFP spool list, even when the last one is under an hour old
  --spoolease-host <host>    SpoolEase console (default: as for every other command)
  --spoolease-port <port>
  --spoolease-https / --no-spoolease-https
  -h, --help
`;

const OPTIONS = {
  "dry-run": { type: "boolean", default: false },
  yes: { type: "boolean", default: false },
  "preset-folder": { type: "string" },
  "printer-preset": { type: "string", multiple: true },
  "overwrite-presets": { type: "boolean", default: false },
  refresh: { type: "boolean", default: false },
  "spoolease-host": { type: "string" },
  "spoolease-security-key": { type: "string" },
  "spoolease-port": { type: "string" },
  "spoolease-https": { type: "boolean" },
  help: { type: "boolean", short: "h", default: false },
} as const;

class ImportUsageError extends Error {}

const LABEL = 10;
const labelled = (label: string, text: string): string => `${label.padEnd(LABEL)}${text}`;
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

async function connection(values: Record<string, unknown>) {
  let settings: ConsoleSettings;
  try {
    settings = await consoleSettings(values as Parameters<typeof consoleSettings>[0]);
  } catch (err) {
    // Says where the key came from, never what it is.
    throw err instanceof InvalidSecretError ? new ImportUsageError(err.message) : err;
  }
  const port = Number(settings.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new ImportUsageError("--spoolease-port must be a port number");
  const found = spooleaseConnectionFrom(settings, port);
  if (!found)
    throw new ImportUsageError(
      `SpoolEase host and security key are required: ${SPOOLEASE_SETTINGS_HINT}`,
    );
  return found;
}

async function run(argv: string[], io: SyncIo): Promise<number> {
  // Before parsing: parseArgs quotes an unknown option, and a key typed there would be printed back.
  if (argv.some(holdsSecret)) throw new ImportUsageError(KEY_ARGUMENT_ERROR);
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
    allowNegative: true,
    strict: true,
  });
  if (values.help) {
    io.stdout(IMPORT_USAGE);
    return 0;
  }
  if (positionals.length === 0)
    throw new ImportUsageError("name the 3DFP spools to import by their short codes");
  if (positionals.some((code) => !/^[A-Za-z0-9_-]{1,32}$/.test(code)))
    throw new ImportUsageError("a 3DFP short code is letters and digits, as printed on its label");

  const target = await connection(values);
  let api: FilamentProfilesConnection;
  try {
    api = await connectFilamentProfiles();
  } catch (err) {
    throw err instanceof MissingKeyError ? new ImportUsageError(err.message) : err;
  }
  const [defaults, remembered] = await Promise.all([bambuDefaults(), loadTuiSettings()]);
  const presetFolder = values["preset-folder"] ?? defaults.presetFolder;
  const printers =
    values["printer-preset"] ??
    (remembered.printers.length ? remembered.printers : [defaults.printer]);

  const basis = await readImportBasis(api, target, { refresh: values.refresh });
  if (basis.linkWarning) io.stderr(`${basis.linkWarning}\n`);
  const read = await prepareFromApi(api, basis, positionals);
  for (const warning of read.warnings) io.stderr(`${warning}\n`);
  const { prepared } = read;
  const calls = (basis.fromCache ? 0 : 1) + read.calls;

  io.stdout(
    `3DFP import: presets in ${presetFolder} for ${printers.join(", ")} · SpoolEase ${target.host}\n\n`,
  );
  const lines = [
    ...prepared.items.flatMap((item) => [
      labelled(
        "Import",
        `${item.spool.shortCode} ${item.profile.name}: presets, SpoolEase filament ${item.profile.filamentId} and a spool`,
      ),
      " ".repeat(LABEL) + importSettingsText(item),
    ]),
    ...prepared.refused.map((refusal) => labelled("Skip", `${refusal.code}: ${refusal.reason}`)),
  ];
  io.stdout(`${lines.join("\n")}\n\n`);
  if (prepared.items.length === 0) {
    io.stdout("Nothing to import.\n");
    return 1;
  }
  const writeCalls = Math.ceil(prepared.items.length / MAX_BULK_UPDATES);
  const summary = `${plural(prepared.items.length, "spool")} to import (${plural(calls, "API call")} so far, ${plural(writeCalls, "more")} to link them).`;
  if (values["dry-run"]) {
    io.stdout(`${summary} Dry run: nothing changed.\n`);
    return prepared.refused.length ? 1 : 0;
  }
  io.stdout(`${summary}\n`);
  if (!values.yes) {
    const yes = (await io.confirm?.("Import? [y/N] ")) ?? null;
    if (yes === null) {
      io.stdout("Not imported: pass --yes, or run this in a terminal to be asked.\n");
      return 0;
    }
    if (!yes) {
      io.stdout("Nothing changed.\n");
      return 0;
    }
  }

  await api.ledger.ensure(writeCalls);
  const applied = await applyImport(prepared, {
    sync: {
      presetFolder,
      printers,
      dryRun: false,
      overwritePresets: values["overwrite-presets"],
    },
    connection: target,
    tdfp: api.client,
    now: new Date(),
  });
  const setAside = await saveImportLinks(api, target.host, applied);
  if (setAside) io.stderr(`The unreadable spool link file was kept as ${tildePath(setAside)}.\n`);

  const report = applied.outcomes.map((outcome) =>
    outcome.spoolId
      ? labelled(
          "Imported",
          `${outcome.code} → SpoolEase spool #${outcome.spoolId}${outcome.warning ? `; ${outcome.warning}` : ""}`,
        )
      : labelled("Failed", `${outcome.code}: ${outcome.error ?? "not imported"}`),
  );
  io.stdout(`${report.join("\n")}\n`);
  const imported = applied.outcomes.filter((outcome) => outcome.spoolId).length;
  io.stdout(
    `Done: ${plural(imported, "spool")} imported (${plural(calls + applied.calls, "API call")}). Weigh them on SpoolEase: \`bambu-hando 3dfp sync\` then keeps the weights in step.\n`,
  );
  return imported === positionals.length ? 0 : 1;
}

export async function tdfpImportCommand(argv: string[], io: SyncIo): Promise<number> {
  try {
    return await run(argv, io);
  } catch (err) {
    if (
      err instanceof ImportUsageError ||
      (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS"))
    ) {
      io.stderr(`bambu-hando: error: ${err.message}\n\n${IMPORT_USAGE}`);
      return 2;
    }
    if (err instanceof KeyCheckError) {
      io.stderr(`${err.message}\n`);
      return 2;
    }
    io.stderr(`bambu-hando: error: ${errorMessage(err)}\n`);
    const keyOrQuota =
      err instanceof QuotaError ||
      (err instanceof FilamentProfilesError && (err.status === 401 || err.status === 402));
    return keyOrQuota ? 2 : 1;
  }
}
