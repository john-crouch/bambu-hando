// ABOUTME: `bambu-hando 3dfp`: the account's 3DFilamentProfiles spools, API calls left, and the local filament catalog.
// ABOUTME: Every action says what it cost; nothing refreshes a stale record unasked. Exit 2 for usage, key or quota trouble.

import { parseArgs } from "node:util";

import { QuotaError, type QuotaState, quotaReset, utcMinute } from "./apiQuota.js";
import { errorMessage } from "./errors.js";
import { catalogPath, FilamentCatalog } from "./filamentCatalog.js";
import {
  type CatalogApi,
  filamentName,
  filamentRecord,
  localRecord,
  type RecordResult,
  searchOnline,
} from "./filamentCatalogSync.js";
import { loadFilamentDb } from "./filamentDb.js";
import {
  FilamentProfilesError,
  type TdfpFilament,
  type TdfpFilamentDetail,
  type TdfpSpool,
} from "./filamentProfiles.js";
import { mySpools } from "./filamentProfilesCache.js";
import {
  connectFilamentProfiles,
  type FilamentProfilesConnection,
  MissingKeyError,
} from "./filamentProfilesConnect.js";
import { tildePath } from "./paths.js";
import { holdsSecret, KEY_ARGUMENT_ERROR } from "./secrets.js";
import { spoolSyncCommand } from "./spoolSyncCommand.js";
import { tdfpImportCommand } from "./tdfpImportCommand.js";

interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** For `sync`: asks a yes/no question, null when there's no terminal to ask on. */
  confirm?: (question: string) => Promise<boolean | null>;
}

export const TDFP_USAGE = `Usage: bambu-hando 3dfp <usage|spools|sync|import|filament|search|fill|catalog> [options]

Reads your 3DFilamentProfiles account with the API key from \`bambu-hando key set 3dfp\`
(or FILAMENTPROFILES_API_KEY). The API allows a monthly number of calls, so bambu-hando
counts them and keeps what it read in a local catalog.

  usage            How many API calls are left this month (no call)
  spools           Your spools: one call, or none while the last list is under an hour old
  sync             Link your SpoolEase spools to them and keep their weights current
                   (bambu-hando 3dfp sync --help)
  import <code>... Bring 3DFP spools into BambuStudio and SpoolEase, and link them
                   (bambu-hando 3dfp import --help)
  filament <id>    A filament's full record: one call the first time, then from the catalog
  search <words>   Filaments in the catalog (no call); --online searches 3DFilamentProfiles (one call)
  fill             Moved to filament-db: run \`filament-db 3dfp fill\` instead
  catalog          What the catalog holds (no call)

Options:
  --refresh          spools: fetch the whole list again, even when it's fresh
  --refresh-stale    filament: fetch a record again when it's 30 days old or more
  --online           search: ask 3DFilamentProfiles (one call) and keep the results
  --brand <key>      search: only this brand key (e.g. sunlu)
  --material <key>   search: only this material key (e.g. petg)
  --json             spools, filament: print snake_case JSON
  -h, --help         Show this help
`;

const OPTIONS = {
  refresh: { type: "boolean", default: false },
  "refresh-stale": { type: "boolean", default: false },
  online: { type: "boolean", default: false },
  brand: { type: "string" },
  material: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

class TdfpUsageError extends Error {}

function quotaLine(state: QuotaState, now: Date): string {
  const resets = `the quota resets ${utcMinute(quotaReset(now))}`;
  if (state.remaining === null || state.limit === null)
    return `3DFilamentProfiles API: calls left this month unknown until the first call; ${resets}.`;
  if (!state.exact)
    return `3DFilamentProfiles API: about ${state.remaining} of ${state.limit} calls left this month (estimated); ${resets}.`;
  const asOf = state.updatedAt ? ` (as of ${utcMinute(new Date(state.updatedAt))})` : "";
  return `3DFilamentProfiles API: ${state.remaining} of ${state.limit} calls left this month${asOf}; ${resets}.`;
}

function spoolName(spool: TdfpSpool): string {
  return [spool.brand, spool.material, spool.materialType, spool.color].filter(Boolean).join(" ");
}

function spoolLines(spools: TdfpSpool[]): string[] {
  const codeWidth = Math.max(0, ...spools.map((s) => s.shortCode.length));
  const nameWidth = Math.max(0, ...spools.map((s) => spoolName(s).length));
  const gramsWidth = Math.max(0, ...spools.map((s) => String(s.remainingGrams).length));
  return spools.map(
    (s) =>
      `${s.shortCode.padEnd(codeWidth)}  ${spoolName(s).padEnd(nameWidth)}  ${String(s.remainingGrams).padStart(gramsWidth)} g  ${s.location ?? "-"}`,
  );
}

const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const snakeKeys = (record: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [snakeCase(key), value]));

async function connect(): Promise<FilamentProfilesConnection> {
  try {
    return await connectFilamentProfiles();
  } catch (err) {
    throw err instanceof MissingKeyError ? new TdfpUsageError(err.message) : err;
  }
}

function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

function quotaLeft(quota: QuotaState): string {
  return quota.remaining === null || quota.limit === null
    ? ""
    : `; ${quota.exact ? "" : "about "}${quota.remaining} of ${quota.limit} left this month`;
}

/** The catalog with the API; connects first, so a missing key fails before the catalog is opened. */
async function catalogApi(): Promise<CatalogApi> {
  const { client, ledger } = await connect();
  return { client, ledger, catalog: FilamentCatalog.open() };
}

function range(low: number | null, high: number | null): string | null {
  if (low === null && high === null) return null;
  if (low === null || high === null || low === high) return String(low ?? high);
  return `${low}-${high}`;
}

function line(parts: (string | null)[]): string | null {
  const text = parts.filter((part): part is string => part !== null).join(" · ");
  return text ? `  ${text[0]?.toUpperCase()}${text.slice(1)}` : null;
}

function recordLines(filament: TdfpFilamentDetail): string[] {
  const at = (value: string | null, text: (value: string) => string) =>
    value === null ? null : text(value);
  const nozzle = range(filament.tempMin, filament.tempMax);
  const bed = range(filament.bedTempMin, filament.bedTempMax);
  const weight =
    filament.nominalWeight !== null && filament.spoolWeight !== null
      ? `${filament.nominalWeight} g on a ${filament.spoolWeight} g spool`
      : filament.nominalWeight !== null
        ? `${filament.nominalWeight} g`
        : filament.spoolWeight !== null
          ? `${filament.spoolWeight} g spool`
          : null;
  const drying =
    filament.dryTempMax !== null && filament.dryTime !== null
      ? `drying ${filament.dryTempMax} °C for ${filament.dryTime} h`
      : filament.dryTempMax !== null
        ? `drying ${filament.dryTempMax} °C`
        : filament.dryTime !== null
          ? `drying for ${filament.dryTime} h`
          : null;
  const num = (value: number | null) => (value === null ? null : String(value));
  return [
    `${filamentName(filament)}${filament.discontinued ? " (discontinued)" : ""} (3DFilamentProfiles #${filament.id})`,
    line([
      at(nozzle, (v) => `nozzle ${v} °C`),
      at(bed, (v) => `bed ${v} °C`),
      at(num(filament.chamberTemp), (v) => `chamber ${v} °C`),
    ]),
    line([
      at(
        num(filament.density === null ? null : filament.density / 1000),
        (v) => `density ${v} g/cm³`,
      ),
      at(
        num(filament.diameter === null ? null : filament.diameter / 1000),
        (v) => `diameter ${v} mm`,
      ),
      weight,
    ]),
    line([
      at(num(filament.flowRatio), (v) => `flow ratio ${v}`),
      at(num(filament.kValue), (v) => `K ${v}`),
      at(num(filament.maxVolumetricSpeed), (v) => `max volumetric speed ${v} mm³/s`),
    ]),
    line([drying, at(num(filament.softeningTemp), (v) => `softens at ${v} °C`)]),
    filament.url ? `  ${filament.url}` : null,
  ].filter((text): text is string => text !== null);
}

function recordFooter(result: RecordResult, quota: QuotaState | null): string {
  if (result.fetched) return `Fetched just now (1 API call${quota ? quotaLeft(quota) : ""}).`;
  const fetched = result.entry.recordAt?.toISOString().slice(0, 10) ?? "?";
  if (result.fromExport) return `From filament-db's export, fetched ${fetched} (no API call).`;
  if (!result.stale) return `From the catalog, fetched ${fetched} (no API call).`;
  return `From the catalog, fetched ${fetched} (${result.ageDays} days old; --refresh-stale fetches it again: 1 API call).`;
}

async function filamentAction(
  idText: string | undefined,
  refreshStale: boolean,
  json: boolean,
  io: Io,
): Promise<number> {
  if (idText === undefined || !/^\d+$/.test(idText))
    throw new TdfpUsageError(
      "filament needs the filament's number, as in its 3DFilamentProfiles link",
    );
  // No key or keyring needed when the catalog's or filament-db's copy will do.
  const exported = await loadFilamentDb();
  if (exported.warning) io.stderr(`${exported.warning}\n`);
  const catalog = FilamentCatalog.open();
  let local: RecordResult | null;
  try {
    local = localRecord(catalog, Number(idText), new Date(), { refreshStale }, exported.db);
  } finally {
    catalog.close();
  }
  const api = local ? null : await catalogApi();
  try {
    const result =
      local ?? (await filamentRecord(api as CatalogApi, Number(idText), { refreshStale }));
    if (result.warning) io.stderr(`${result.warning}\n`);
    const record = result.entry.record;
    if (!record) throw new Error(`filament ${idText} has no full record`);
    if (json) {
      const report = {
        filament: snakeKeys(record),
        fetched: result.fetched,
        from_export: result.fromExport,
        stale: result.stale,
        age_days: result.ageDays,
        record_at: result.entry.recordAt?.toISOString() ?? null,
      };
      io.stdout(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    io.stdout(
      `${[...recordLines(record), recordFooter(result, api ? await api.ledger.current() : null)].join("\n")}\n`,
    );
    return 0;
  } finally {
    api?.catalog.close();
  }
}

function filamentLines(filaments: TdfpFilament[]): string[] {
  const width = Math.max(0, ...filaments.map((f) => String(f.id).length));
  return filaments.map(
    (f) =>
      `#${String(f.id).padEnd(width)}  ${filamentName(f)}${f.discontinued ? " (discontinued)" : ""}`,
  );
}

const SEARCH_LIMIT = 50;

async function searchAction(
  words: string,
  brand: string | undefined,
  material: string | undefined,
  online: boolean,
  io: Io,
): Promise<number> {
  if (!words && !brand && !material)
    throw new TdfpUsageError("search needs words, --brand or --material");
  if (online) {
    const api = await catalogApi();
    try {
      const page = await searchOnline(api, {
        q: words || undefined,
        brand,
        material,
        limit: SEARCH_LIMIT,
      });
      const total = `${page.totalIsEstimate ? "about " : ""}${page.total}`;
      const footer = `${page.filaments.length} of ${total} match${page.total === 1 ? "" : "es"} from 3DFilamentProfiles (1 API call${quotaLeft(await api.ledger.current())}).`;
      io.stdout(`${[...filamentLines(page.filaments), footer].join("\n")}\n`);
      return 0;
    } finally {
      api.catalog.close();
    }
  }
  // The local search needs no key or keyring.
  const catalog = FilamentCatalog.open();
  try {
    const found = catalog.search({ words, brand, material }, SEARCH_LIMIT);
    if (found.length === 0) {
      io.stdout(
        "No matches in the catalog (no API call; --online searches 3DFilamentProfiles: 1 call).\n",
      );
      return 0;
    }
    const shown =
      found.length === SEARCH_LIMIT
        ? `the first ${SEARCH_LIMIT} matches`
        : plural(found.length, "match", "matches");
    io.stdout(
      `${[...filamentLines(found), `${shown[0]?.toUpperCase()}${shown.slice(1)} in the catalog (no API call).`].join("\n")}\n`,
    );
    return 0;
  } finally {
    catalog.close();
  }
}

/** `3dfp fill` stays only to say where the fill went: the README used to have people run it from a timer. */
const FILL_MOVED = "the month-end fill moved to filament-db: run `filament-db 3dfp fill` instead";

async function catalogAction(io: Io): Promise<number> {
  const catalog = FilamentCatalog.open();
  try {
    const stats = catalog.stats();
    io.stdout(
      `3DFilamentProfiles catalog: ${plural(stats.filaments, "filament")} (${plural(stats.records, "full record")}) from ${plural(stats.brands, "brand")}, ${plural(stats.completeBrands, "brand")} filled; ${tildePath(catalogPath())}\n`,
    );
    return 0;
  } finally {
    catalog.close();
  }
}

async function spoolsAction(refresh: boolean, json: boolean, io: Io): Promise<number> {
  const { client, ledger, account } = await connect();
  const result = await mySpools(client, { account, refresh });
  const quota = await ledger.current();
  const now = new Date();
  if (json) {
    const report = {
      fetched_at: result.fetchedAt.toISOString(),
      from_cache: result.fromCache,
      changes_only: result.changesOnly,
      spools: result.spools.map(snakeKeys),
      quota: {
        limit: quota.limit,
        remaining: quota.remaining,
        exact: quota.exact,
        resets_at: quotaReset(now).toISOString(),
      },
    };
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  const count = `${result.spools.length} spool${result.spools.length === 1 ? "" : "s"}`;
  const left =
    quota.remaining === null || quota.limit === null
      ? ""
      : `; ${quota.exact ? "" : "about "}${quota.remaining} of ${quota.limit} left this month`;
  const footer = result.fromCache
    ? `${count} from the cache, fetched ${utcMinute(result.fetchedAt)} (no API call; --refresh fetches again)`
    : `${count} from 3DFilamentProfiles${result.changesOnly ? ", with what changed since the last list" : ""} (1 API call${left})`;
  io.stdout(`${[...spoolLines(result.spools), footer].join("\n")}\n`);
  return 0;
}

export async function filamentProfilesCommand(argv: string[], io: Io): Promise<number> {
  if (argv[0] === "sync") return spoolSyncCommand(argv.slice(1), io);
  if (argv[0] === "import") return tdfpImportCommand(argv.slice(1), io);
  // Before parsing, so the old flags (--now, --reserve) a timer may still pass get the same answer.
  if (argv[0] === "fill") {
    io.stderr(`bambu-hando: error: ${FILL_MOVED}\n`);
    return 2;
  }
  try {
    // Before parsing: parseArgs quotes an unknown option, and a key typed there would be printed back.
    if (argv.some(holdsSecret)) throw new TdfpUsageError(KEY_ARGUMENT_ERROR);
    const { values, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    const [action, ...extra] = positionals;
    if (values.help || action === undefined) {
      io.stdout(TDFP_USAGE);
      return 0;
    }
    if (action === "search")
      return await searchAction(
        extra.join(" ").trim(),
        values.brand,
        values.material,
        values.online,
        io,
      );
    if (action === "filament") {
      if (extra.length > 1) throw new TdfpUsageError("filament takes one id");
      return await filamentAction(extra[0], values["refresh-stale"], values.json, io);
    }
    if (extra.length > 0) throw new TdfpUsageError(`unexpected argument after ${action}`);
    if (action === "spools") return await spoolsAction(values.refresh, values.json, io);
    if (action === "catalog") return await catalogAction(io);
    if (action === "usage") {
      const { ledger } = await connect();
      io.stdout(`${quotaLine(await ledger.current(), new Date())}\n`);
      return 0;
    }
    // Not quoted: a pasted key without its prefix would be printed back.
    throw new TdfpUsageError(
      "unknown action (usage, spools, sync, filament, search, fill or catalog)",
    );
  } catch (err) {
    if (
      err instanceof TdfpUsageError ||
      (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS"))
    ) {
      io.stderr(`bambu-hando: error: ${err.message}\n\n${TDFP_USAGE}`);
      return 2;
    }
    io.stderr(`bambu-hando: error: ${errorMessage(err)}\n`);
    const keyOrQuota =
      err instanceof QuotaError ||
      (err instanceof FilamentProfilesError && (err.status === 401 || err.status === 402));
    return keyOrQuota ? 2 : 1;
  }
}
