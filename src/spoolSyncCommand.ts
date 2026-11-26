// ABOUTME: `bambu-hando 3dfp sync`: links SpoolEase spools to 3DFilamentProfiles spools and keeps 3DFP's weights current.
// ABOUTME: Prints the plan, asks before writing (or takes --yes), and keeps the links in a local file. Exit 2 for usage, key or quota trouble.

import { parseArgs } from "node:util";

import { QuotaError, type QuotaState, utcMinute } from "./apiQuota.js";
import { errorMessage } from "./errors.js";
import { FilamentCatalog } from "./filamentCatalog.js";
import { filamentName } from "./filamentCatalogSync.js";
import { FilamentProfilesError, type TdfpSpool } from "./filamentProfiles.js";
import { forgetSpools, mySpools } from "./filamentProfilesCache.js";
import {
  connectFilamentProfiles,
  type FilamentProfilesConnection,
  MissingKeyError,
} from "./filamentProfilesConnect.js";
import { tildePath } from "./paths.js";
import { holdsSecret, InvalidSecretError, KEY_ARGUMENT_ERROR } from "./secrets.js";
import { SpoolEaseClient, type SpoolRecord } from "./spoolease.js";
import {
  type ConsoleSettings,
  consoleSettings,
  SPOOLEASE_SETTINGS_HINT,
  spooleaseConnectionFrom,
} from "./spooleaseConfig.js";
import { remainingGrams } from "./spoolInventory.js";
import { linksPath, loadLinks, saveLinks } from "./spoolLinks.js";
import {
  applySync,
  planSync,
  type SyncChoices,
  type SyncPlan,
  SyncPlanError,
  type SyncRow,
  type WeightVerdict,
} from "./spoolSync.js";
import { checkKey, KeyCheckError } from "./sync.js";

export interface SyncIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Asks a yes/no question; null when there's no terminal to ask on. */
  confirm?: (question: string) => Promise<boolean | null>;
}

export const SYNC_USAGE = `Usage: bambu-hando 3dfp sync [options]

Links your SpoolEase spools to your 3DFilamentProfiles spools and keeps 3DFP's
weights up to date. It shows what it would do and asks before writing anything.

A SpoolEase spool and a 3DFP spool with the same brand, material and color are
linked by themselves; --link pairs others. The links live in a local file, and
a linked spool's SpoolEase tag UID is also written to its 3DFP spool.

Weights: on a new link, SpoolEase's scale wins. After that, the side that
changed since the last sync wins; when both changed, the lower weight wins.
Only SpoolEase's scale can set SpoolEase's weight, so when 3DFP's should win,
the plan says to weigh the spool.

A SpoolEase spool not on 3DFP is offered as a new 3DFP spool when exactly one
filament in the local catalog fits it (see \`bambu-hando 3dfp search --online\`).

Options:
  --dry-run                  Show the plan, change nothing
  --yes                      Apply without asking
  --link <id>=<code>         Link SpoolEase spool <id> to 3DFP spool <code> (repeatable)
  --add <id>=<filament>      Add SpoolEase spool <id> to 3DFP as filament <filament> (repeatable)
  --unlink <id>              Forget SpoolEase spool <id>'s link (repeatable)
  --refresh                  Fetch the whole 3DFP spool list, even when the last one is under an hour old
  --spoolease-host <host>    Console host or IP (env: SPOOLEASE_HOST)
  --spoolease-security-key <key>
                             Security key (env: SPOOLEASE_SECURITY_KEY)
  --spoolease-port <port>    Port (default: as saved in Settings with its host, else 80)
  --spoolease-https          Use HTTPS (--no-spoolease-https: don't, even if saved)
  -h, --help                 Show this help

SpoolEase defaults to the console saved in the TUI's Settings (its key kept there
or by bambu-hando key set spoolease), then to the settings saved in BambuStudio.
`;

const OPTIONS = {
  "dry-run": { type: "boolean", default: false },
  yes: { type: "boolean", default: false },
  link: { type: "string", multiple: true },
  add: { type: "string", multiple: true },
  unlink: { type: "string", multiple: true },
  refresh: { type: "boolean", default: false },
  "spoolease-host": { type: "string" },
  "spoolease-security-key": { type: "string" },
  "spoolease-port": { type: "string" },
  "spoolease-https": { type: "boolean" },
  help: { type: "boolean", short: "h", default: false },
} as const;

/** Catalog filaments looked at when suggesting what to add a spool as. */
const CATALOG_LOOKUP = 1000;
/** Fitting filaments listed when there are several. */
const SHOWN_FILAMENTS = 5;

class SyncUsageError extends Error {}

function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

/** "898 of 1000 left this month", or null before the first call. */
function quotaLeft(quota: QuotaState): string | null {
  return quota.remaining === null || quota.limit === null
    ? null
    : `${quota.exact ? "" : "about "}${quota.remaining} of ${quota.limit} left this month`;
}

function parsePairs(values: string[], option: string, value: RegExp): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const text of values) {
    const [id, other, extra] = text.split("=");
    if (extra !== undefined || !id || !/^\S+$/.test(id) || !other || !value.test(other)) {
      throw new SyncUsageError(
        `--${option} takes <SpoolEase id>=<${option === "link" ? "3DFP spool code" : "filament number"}>, not "${text}"`,
      );
    }
    pairs.set(id.trim(), other.trim());
  }
  return pairs;
}

function parseChoices(values: { link: string[]; add: string[]; unlink: string[] }): SyncChoices {
  const add = new Map(
    [...parsePairs(values.add, "add", /^\d+$/)].map(([id, filament]) => [id, Number(filament)]),
  );
  for (const id of values.unlink)
    if (!/^\S+$/.test(id)) throw new SyncUsageError("--unlink takes a SpoolEase spool id");
  return { link: parsePairs(values.link, "link", /^\S+$/), add, unlink: new Set(values.unlink) };
}

const seName = (spool: SpoolRecord): string =>
  [spool.brand, spool.material, spool.subtype, spool.colorName].filter(Boolean).join(" ");
const tdName = (spool: TdfpSpool): string =>
  [spool.brand, spool.material, spool.materialType, spool.color].filter(Boolean).join(" ");
const se = (spool: SpoolRecord): string => `#${spool.id} ${seName(spool)}`;

function weightText(weight: WeightVerdict, tdfp: TdfpSpool, left: number | null): string {
  if (weight.kind === "push")
    return `weight ${tdfp.remainingGrams} → ${weight.grams} g, from SpoolEase`;
  if (weight.kind === "weigh")
    return `SpoolEase ${left} g, 3DFP ${tdfp.remainingGrams} g: put it on SpoolEase's scale (only the scale sets SpoolEase's weight)`;
  if (weight.kind === "unweighed") return "SpoolEase hasn't weighed it yet";
  return `weights agree (${left} g)`;
}

const LABEL = 10;
const labelled = (label: string, text: string): string => `${label.padEnd(LABEL)}${text}`;

function rowLines(row: SyncRow): string[] {
  if (row.kind === "linked") {
    const left = remainingGrams(row.spool);
    const weight = weightText(row.weight, row.tdfp, left);
    const written = [
      row.patch?.bambuTagId !== undefined ? "tag" : null,
      row.patch?.externalId !== undefined ? "SpoolEase ID" : null,
    ].filter(Boolean);
    const tag = written.length ? `${written.join(" and ")} written to 3DFP` : null;
    if (row.before === null) {
      const why =
        row.how === "chosen"
          ? "as asked"
          : row.how === "recorded"
            ? "3DFP keeps its SpoolEase ID"
            : "same brand, material and color";
      return [
        labelled("Link", `${se(row.spool)} ↔ ${row.tdfp.shortCode} ${tdName(row.tdfp)} (${why})`),
        " ".repeat(LABEL) + [weight, tag].filter(Boolean).join("; "),
      ];
    }
    const pair = `${se(row.spool)} ↔ ${row.tdfp.shortCode}`;
    if (row.patch) {
      const parts = [
        row.weight.kind === "push" || row.weight.kind === "weigh" ? weight : null,
        tag,
      ].filter(Boolean);
      return [labelled("Update", `${pair}: ${parts.join("; ")}`)];
    }
    if (row.weight.kind === "weigh") return [labelled("Weigh", `${pair}: ${weight}`)];
    if (row.weight.kind === "unweighed") return [labelled("Unweighed", `${pair}: ${weight}`)];
    return [labelled("In step", `${pair}: ${left} g`)];
  }
  if (row.kind === "add") {
    const as = row.filament
      ? `#${row.filament.id} ${filamentName(row.filament)}`
      : `filament #${row.filamentId}`;
    const grams = row.grams === null ? "at the filament's own weight" : `at ${row.grams} g`;
    return [
      labelled(
        "Add",
        `${se(row.spool)} to 3DFP as ${as} ${grams}${row.tag ? ", with its tag" : ""}`,
      ),
    ];
  }
  if (row.kind === "unlinked") {
    const why = {
      asked: "as asked",
      replaced: "replaced by --link",
      "spoolease-gone": `SpoolEase has no spool #${row.link.spoolease} any more`,
      "tdfp-gone": `3DFilamentProfiles has no spool ${row.link.tdfp} any more`,
    }[row.reason];
    const cleared = row.patch ? "; SpoolEase ID cleared on 3DFP" : "";
    return [labelled("Unlink", `#${row.link.spoolease} ↔ ${row.link.tdfp}: ${why}${cleared}`)];
  }
  if (row.kind === "ambiguous") {
    const codes = row.candidates.map((c) => c.shortCode).join(", ");
    return [
      labelled(
        "Choose",
        `${se(row.spool)}: several 3DFP spools fit (${codes}): pick one with --link ${row.spool.id}=<code>`,
      ),
    ];
  }
  if (row.kind === "suggest") {
    if (row.filaments.length === 0) {
      const words = [row.spool.brand, row.spool.material, row.spool.subtype, row.spool.colorName]
        .filter(Boolean)
        .join(" ");
      return [
        labelled(
          "Choose",
          `${se(row.spool)}: not on 3DFP, and no catalog filament fits: find it with \`bambu-hando 3dfp search --online "${words}"\`, then --add ${row.spool.id}=<filament>`,
        ),
      ];
    }
    const shown = row.filaments.slice(0, SHOWN_FILAMENTS).map((f) => `#${f.id} ${filamentName(f)}`);
    const more =
      row.filaments.length > SHOWN_FILAMENTS
        ? ` and ${row.filaments.length - SHOWN_FILAMENTS} more`
        : "";
    return [
      labelled(
        "Choose",
        `${se(row.spool)}: not on 3DFP; catalog filaments that fit: ${shown.join(", ")}${more}: pick one with --add ${row.spool.id}=<filament>`,
      ),
    ];
  }
  return [
    labelled(
      "3DFP only",
      `${row.tdfp.shortCode} ${tdName(row.tdfp)}: no SpoolEase spool fits: bring it in with \`bambu-hando 3dfp import ${row.tdfp.shortCode}\``,
    ),
  ];
}

function reportSetAside(setAside: string | null, io: SyncIo): void {
  if (setAside) io.stderr(`The unreadable spool link file was kept as ${tildePath(setAside)}.\n`);
}

async function run(argv: string[], io: SyncIo): Promise<number> {
  // Before parsing: parseArgs quotes an unknown option, and a key typed there would be printed back.
  if (argv.some(holdsSecret)) throw new SyncUsageError(KEY_ARGUMENT_ERROR);
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
    allowNegative: true,
    strict: true,
  });
  if (values.help) {
    io.stdout(SYNC_USAGE);
    return 0;
  }
  // Not quoted: a pasted key without its prefix would be printed back.
  if (positionals.length > 0)
    throw new SyncUsageError("sync takes options only, no other arguments");
  const choices = parseChoices({
    link: values.link ?? [],
    add: values.add ?? [],
    unlink: values.unlink ?? [],
  });
  let settings: ConsoleSettings;
  try {
    settings = await consoleSettings(values);
  } catch (err) {
    // Says where the key came from, never what it is.
    throw err instanceof InvalidSecretError ? new SyncUsageError(err.message) : err;
  }
  const port = Number(settings.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new SyncUsageError("--spoolease-port must be a port number");
  const connection = spooleaseConnectionFrom(settings, port);
  if (!connection)
    throw new SyncUsageError(
      `SpoolEase host and security key are required: ${SPOOLEASE_SETTINGS_HINT}`,
    );

  let api: FilamentProfilesConnection;
  try {
    api = await connectFilamentProfiles();
  } catch (err) {
    throw err instanceof MissingKeyError ? new SyncUsageError(err.message) : err;
  }
  const spoolease = new SpoolEaseClient(connection);
  await checkKey(spoolease);
  const seSpools = await spoolease.listSpools();
  const listed = await mySpools(api.client, { account: api.account, refresh: values.refresh });
  const { links, warning, linkedElsewhere } = await loadLinks(
    linksPath(),
    api.account,
    connection.host,
  );
  if (warning) io.stderr(`${warning}\n`);

  const catalog = FilamentCatalog.open();
  let plan: SyncPlan;
  try {
    plan = planSync({
      spoolease: seSpools,
      tdfp: listed.spools,
      links,
      choices,
      filamentsFor: (spool) =>
        catalog.search({ words: `${spool.brand} ${spool.material}` }, CATALOG_LOOKUP),
      filamentById: (id) => catalog.get(id)?.filament ?? null,
      linkedElsewhere,
      now: new Date(),
    });
  } finally {
    catalog.close();
  }

  const fetched = listed.fromCache
    ? `list from ${utcMinute(listed.fetchedAt)}: no API call`
    : "1 API call";
  io.stdout(
    `Spool sync: SpoolEase ${connection.host} (${plural(seSpools.length, "spool")}) · 3DFilamentProfiles (${plural(listed.spools.length, "spool")}, ${fetched})\n\n`,
  );
  const lines = plan.rows.flatMap(rowLines);
  if (lines.length) io.stdout(`${lines.join("\n")}\n\n`);

  if (plan.changes === 0) {
    if (!values["dry-run"])
      reportSetAside(
        await saveLinks(
          linksPath(),
          api.account,
          connection.host,
          (await applySync(plan, api.client)).links,
        ),
        io,
      );
    io.stdout("Nothing to change.\n");
    return 0;
  }
  const before = quotaLeft(await api.ledger.current());
  const summary = `${plural(plan.changes, "change")}: ${plural(plan.calls, "API call")}${before ? ` (${before})` : ""}.`;
  if (values["dry-run"]) {
    io.stdout(`${summary} Dry run: nothing changed.\n`);
    return 0;
  }
  io.stdout(`${summary}\n`);
  if (!values.yes) {
    const yes = (await io.confirm?.("Apply? [y/N] ")) ?? null;
    if (yes === null) {
      io.stdout("Not applied: pass --yes, or run this in a terminal to be asked.\n");
      return 0;
    }
    if (!yes) {
      io.stdout("Nothing changed.\n");
      return 0;
    }
  }

  await api.ledger.ensure(plan.calls);
  const failures: string[] = [];
  const applied = await applySync(plan, api.client, (outcome) => {
    if (outcome.ok) return;
    const row = outcome.row;
    const what =
      row.kind === "linked"
        ? `#${row.spool.id} ↔ ${row.tdfp.shortCode}`
        : row.kind === "add"
          ? `#${row.spool.id}`
          : row.kind === "unlinked"
            ? `#${row.link.spoolease} ↔ ${row.link.tdfp}`
            : "";
    failures.push(labelled("Failed", `${what}: ${outcome.error}`));
  });
  reportSetAside(await saveLinks(linksPath(), api.account, connection.host, applied.links), io);
  if (applied.outcomes.some((outcome) => outcome.ok || outcome.created)) await forgetSpools();

  const calls = applied.calls;
  const done = plan.changes - failures.length;
  if (failures.length) io.stdout(`${failures.join("\n")}\n`);
  const after = quotaLeft(await api.ledger.current());
  const failed = failures.length ? `, ${failures.length} failed` : "";
  io.stdout(
    `Done: ${plural(done, "change")} applied${failed} (${plural(calls, "API call")}${after ? `; ${after}` : ""}). Links: ${tildePath(linksPath())}\n`,
  );
  return failures.length ? 1 : 0;
}

export async function spoolSyncCommand(argv: string[], io: SyncIo): Promise<number> {
  try {
    return await run(argv, io);
  } catch (err) {
    if (
      err instanceof SyncUsageError ||
      (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS"))
    ) {
      io.stderr(`bambu-hando: error: ${err.message}\n\n${SYNC_USAGE}`);
      return 2;
    }
    if (err instanceof KeyCheckError) {
      io.stderr(`${err.message}\n`);
      return 2;
    }
    io.stderr(`bambu-hando: error: ${errorMessage(err)}\n`);
    const keyOrQuota =
      err instanceof SyncPlanError ||
      err instanceof QuotaError ||
      (err instanceof FilamentProfilesError && (err.status === 401 || err.status === 402));
    return keyOrQuota ? 2 : 1;
  }
}
