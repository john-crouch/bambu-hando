// ABOUTME: Fills the local 3DFilamentProfiles catalog from the API: full records on demand, fill searches, month-end fill.
// ABOUTME: A stale record is refreshed only when asked; fills never spend into the reserve and resume where they stopped.

import { QuotaError, type QuotaLedger } from "./apiQuota.js";
import { errorMessage } from "./errors.js";
import {
  type CatalogEntry,
  type FilamentCatalog,
  recordAgeDays,
  recordIsStale,
  STALE_AFTER_DAYS,
} from "./filamentCatalog.js";
import type {
  FilamentFilters,
  FilamentPage,
  FilamentProfilesClient,
  TdfpFilament,
} from "./filamentProfiles.js";
import { FilamentProfilesError } from "./filamentProfiles.js";

export interface CatalogApi {
  client: FilamentProfilesClient;
  catalog: FilamentCatalog;
  ledger: QuotaLedger;
  now?: () => Date;
}

export const FILL_FROM_DAY = 28;
export const FILL_RESERVE = 100;
const PAGE_SIZE = 50;
const MAX_PAGE = 20;
const DAY_MS = 86_400_000;
/** Tried when discovering brands, since a material no page has shown yet can't be found otherwise. */
const COMMON_MATERIALS = [
  "pla",
  "petg",
  "abs",
  "asa",
  "tpu",
  "pa",
  "pc",
  "pet",
  "hips",
  "pva",
  "pp",
];

const clock = (api: CatalogApi): Date => (api.now ?? (() => new Date()))();

export function filamentName(filament: TdfpFilament): string {
  return [filament.brandName, filament.material, filament.materialType, filament.color]
    .filter(Boolean)
    .join(" ");
}

export interface RecordResult {
  entry: CatalogEntry;
  /** True when this call fetched it (one API call). */
  fetched: boolean;
  ageDays: number | null;
  /** STALE_AFTER_DAYS old or more. */
  stale: boolean;
  warning: string | null;
}

/** The catalog's record when it will do without a call (present, and fresh or not to be refreshed); else null. */
export function localRecord(
  catalog: FilamentCatalog,
  id: number,
  now: Date,
  options: { refreshStale?: boolean } = {},
): RecordResult | null {
  const cached = catalog.get(id);
  if (!cached?.record) return null;
  const stale = recordIsStale(cached, now);
  return !stale || !options.refreshStale
    ? { entry: cached, fetched: false, ageDays: recordAgeDays(cached, now), stale, warning: null }
    : null;
}

/** A filament's full record: fetched when missing; when stale, refreshed only with refreshStale. */
export async function filamentRecord(
  api: CatalogApi,
  id: number,
  options: { refreshStale?: boolean } = {},
): Promise<RecordResult> {
  const now = clock(api);
  const local = localRecord(api.catalog, id, now, options);
  if (local) return local;
  const cached = api.catalog.get(id);
  try {
    const record = await api.client.getFilament(id);
    api.catalog.saveRecord(id, record, now);
    const entry = api.catalog.get(record.id);
    if (!entry) throw new Error(`filament ${record.id} wasn't saved`);
    return { entry, fetched: true, ageDays: 0, stale: false, warning: null };
  } catch (err) {
    if (!cached?.record || !cached.recordAt) throw err;
    const copy = cached.recordAt.toISOString().slice(0, 10);
    const warning = `couldn't refresh ${filamentName(cached.filament)} (${errorMessage(err)}): using the copy from ${copy}`;
    return {
      entry: cached,
      fetched: false,
      ageDays: recordAgeDays(cached, now),
      stale: true,
      warning,
    };
  }
}

/** One search on the API (one call); its results go into the catalog. */
export async function searchOnline(
  api: CatalogApi,
  filters: FilamentFilters,
): Promise<FilamentPage> {
  const page = await api.client.listFilaments(filters);
  api.catalog.saveSummaries(page.filaments, clock(api));
  return page;
}

/** A fill key's filters: "all" is none; otherwise comma-joined name:value pairs. */
export function fillFilters(key: string): FilamentFilters {
  if (key === "all") return {};
  const filters: FilamentFilters = {};
  for (const pair of key.split(",")) {
    const [name, value] = pair.split(":");
    if ((name === "brand" || name === "material" || name === "type") && value)
      filters[name] = value;
  }
  return filters;
}

export interface FillResult {
  key: string;
  calls: number;
  saved: number;
  complete: boolean;
  truncated: boolean;
  /** Why it stopped before finishing: the quota or reserve, or an API error. */
  stoppedBy: string | null;
}

export interface FillOptions {
  reserve?: number;
  /** Waits between calls, to stay gentle with the API. */
  pause?: () => Promise<void>;
}

/**
 * The API refused this request itself (an unknown brand, a filament it no longer has), so asking again won't help.
 * Not a rejected key (401), lapsed access (402) or a timeout (408): those are about the account or the moment.
 */
function requestRefused(err: unknown): boolean {
  return (
    err instanceof FilamentProfilesError &&
    err.status !== null &&
    err.status >= 400 &&
    err.status < 500 &&
    ![401, 402, 408].includes(err.status)
  );
}

const freshlyComplete = (
  progress: { complete: boolean; updatedAt: Date } | null,
  now: Date,
): boolean =>
  progress?.complete === true &&
  now.getTime() - progress.updatedAt.getTime() < STALE_AFTER_DAYS * DAY_MS;

/** Pages through one search into the catalog; skipped when completed in the last 30 days, resumed when it stopped. */
export async function fillSearch(
  api: CatalogApi,
  key: string,
  options: FillOptions = {},
): Promise<FillResult> {
  const progress = api.catalog.fill(key);
  const result: FillResult = {
    key,
    calls: 0,
    saved: 0,
    complete: false,
    truncated: false,
    stoppedBy: null,
  };
  if (freshlyComplete(progress, clock(api)))
    return { ...result, complete: true, truncated: progress?.truncated ?? false };
  let page = progress && !progress.complete ? progress.nextPage : 1;
  while (page <= MAX_PAGE) {
    try {
      await api.ledger.ensure(1, options.reserve ?? 0);
      if (result.calls > 0) await options.pause?.();
      result.calls += 1;
      const listed = await searchOnline(api, { ...fillFilters(key), limit: PAGE_SIZE, page });
      result.saved += listed.filaments.length;
      page += 1;
      if (listed.last) result.complete = true;
      else if (page > MAX_PAGE) result.complete = result.truncated = true;
    } catch (err) {
      // A search the API refuses (an unknown key) won't work next time either: count it as done.
      if (requestRefused(err)) result.complete = true;
      else result.stoppedBy = err instanceof QuotaError ? err.message : errorMessage(err);
    }
    api.catalog.saveFill({
      key,
      nextPage: result.complete ? 1 : page,
      complete: result.complete,
      truncated: result.truncated,
      updatedAt: clock(api),
    });
    if (result.complete || result.stoppedBy) break;
  }
  return result;
}

export interface MonthEndOptions extends FillOptions {
  /** Start before the 28th. */
  force?: boolean;
  fromDay?: number;
  /** Filaments on the account's spools: their records come first, then their brands. */
  ownedFilamentIds?: number[];
  /** Told about each search as it finishes, for progress output. */
  onSearch?: (result: FillResult) => void;
}

export interface MonthEndReport {
  ran: boolean;
  reason: string;
  calls: number;
  records: number;
  searches: FillResult[];
}

/** What to fill next, most useful first; null when everything is filled. */
function nextSearch(
  api: CatalogApi,
  ownedBrands: string[],
  tried: Set<string>,
  now: Date,
): string | null {
  const open = (key: string) => !tried.has(key) && !freshlyComplete(api.catalog.fill(key), now);
  const brandKeys = api.catalog.brandKeys();
  const candidates = [
    ...ownedBrands.map((brand) => `brand:${brand}`),
    ...api.catalog
      .fills()
      .filter((fill) => !fill.complete)
      .map((fill) => fill.key),
    ...brandKeys.map((brand) => `brand:${brand}`),
    ...api.catalog
      .fills()
      .filter((fill) => fill.truncated && fill.key.startsWith("brand:") && !fill.key.includes(","))
      .flatMap((fill) => {
        const brand = fill.key.slice("brand:".length);
        return [...new Set([...api.catalog.materialKeys(brand), ...COMMON_MATERIALS])].map(
          (material) => `brand:${brand},material:${material}`,
        );
      }),
    "all",
    ...[...new Set([...api.catalog.materialKeys(), ...COMMON_MATERIALS])].map(
      (material) => `material:${material}`,
    ),
  ];
  return candidates.find(open) ?? null;
}

/**
 * Spends the month's leftover calls, down to the reserve, filling the catalog: unused calls don't carry over.
 * Owned filaments' records first, then their brands, other known brands, and searches that turn up new brands.
 */
export async function monthEndFill(
  api: CatalogApi,
  options: MonthEndOptions = {},
): Promise<MonthEndReport> {
  const now = clock(api);
  const fromDay = options.fromDay ?? FILL_FROM_DAY;
  const report: MonthEndReport = { ran: false, reason: "", calls: 0, records: 0, searches: [] };
  if (!options.force && now.getUTCDate() < fromDay) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), fromDay));
    return {
      ...report,
      reason: `the month-end fill starts on ${start.toISOString().slice(0, 10)} (UTC)`,
    };
  }
  report.ran = true;
  const reserve = options.reserve ?? FILL_RESERVE;
  try {
    for (const id of options.ownedFilamentIds ?? []) {
      if (api.catalog.get(id)?.record) continue;
      await api.ledger.ensure(1, reserve);
      if (report.calls > 0) await options.pause?.();
      report.calls += 1;
      try {
        await filamentRecord(api, id);
        report.records += 1;
      } catch (err) {
        // A filament the API no longer has shouldn't hold up the rest of the fill.
        if (!requestRefused(err)) throw err;
      }
    }
  } catch (err) {
    report.reason = errorMessage(err);
    return report;
  }
  const ownedBrands = [
    ...new Set(
      (options.ownedFilamentIds ?? [])
        .map((id) => api.catalog.get(id)?.filament.brandKey)
        .filter((key): key is string => !!key),
    ),
  ];
  const tried = new Set<string>();
  for (
    let key = nextSearch(api, ownedBrands, tried, now);
    key !== null;
    key = nextSearch(api, ownedBrands, tried, now)
  ) {
    tried.add(key);
    if (report.calls > 0) await options.pause?.();
    const result = await fillSearch(api, key, { reserve, pause: options.pause });
    report.searches.push(result);
    report.calls += result.calls;
    options.onSearch?.(result);
    if (result.stoppedBy) {
      report.reason = result.stoppedBy;
      return report;
    }
  }
  report.reason = "nothing left to fill";
  return report;
}
