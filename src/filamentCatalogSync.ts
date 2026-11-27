// ABOUTME: Fills the local 3DFilamentProfiles catalog from the API: full records on demand (filament-db's copy first) and
// ABOUTME: online searches. A stale record is refreshed only when asked. The month-end fill lives in filament-db.

import type { QuotaLedger } from "./apiQuota.js";
import { errorMessage } from "./errors.js";
import {
  type CatalogEntry,
  type FilamentCatalog,
  recordAgeDays,
  recordIsStale,
} from "./filamentCatalog.js";
import { type FilamentDb, loadFilamentDb } from "./filamentDb.js";
import type {
  FilamentFilters,
  FilamentPage,
  FilamentProfilesClient,
  TdfpFilament,
} from "./filamentProfiles.js";

export interface CatalogApi {
  client: FilamentProfilesClient;
  catalog: FilamentCatalog;
  ledger: QuotaLedger;
  now?: () => Date;
}

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
  /** True when it came from filament-db's export (no API call). */
  fromExport: boolean;
  ageDays: number | null;
  /** STALE_AFTER_DAYS old or more. */
  stale: boolean;
  warning: string | null;
}

/** filament-db's record of the filament, when it has one under STALE_AFTER_DAYS old; else null. */
function exportRecord(db: FilamentDb | null, id: number, now: Date): RecordResult | null {
  const found = db?.tdfpRecord(id);
  if (!found) return null;
  const entry: CatalogEntry = {
    filament: found.record,
    summaryAt: found.fetchedAt,
    record: found.record,
    recordAt: found.fetchedAt,
  };
  if (recordIsStale(entry, now)) return null;
  const ageDays = recordAgeDays(entry, now);
  return { entry, fetched: false, fromExport: true, ageDays, stale: false, warning: null };
}

/**
 * A record that will do without a call: filament-db's export's when it's fresh and newer than the catalog's, else the
 * catalog's (present, and fresh or not to be refreshed); else null.
 */
export function localRecord(
  catalog: FilamentCatalog,
  id: number,
  now: Date,
  options: { refreshStale?: boolean } = {},
  db: FilamentDb | null = null,
): RecordResult | null {
  const cached = catalog.get(id);
  const exported = exportRecord(db, id, now);
  if (
    exported &&
    !(
      cached?.record &&
      cached.recordAt &&
      exported.entry.recordAt &&
      cached.recordAt > exported.entry.recordAt
    )
  )
    return exported;
  if (!cached?.record) return null;
  const stale = recordIsStale(cached, now);
  return !stale || !options.refreshStale
    ? {
        entry: cached,
        fetched: false,
        fromExport: false,
        ageDays: recordAgeDays(cached, now),
        stale,
        warning: null,
      }
    : null;
}

/**
 * A filament's full record: filament-db's export's when fresh, else the catalog's; fetched when missing; when stale,
 * refreshed only with refreshStale.
 */
export async function filamentRecord(
  api: CatalogApi,
  id: number,
  options: { refreshStale?: boolean } = {},
): Promise<RecordResult> {
  const now = clock(api);
  const local = localRecord(api.catalog, id, now, options, (await loadFilamentDb()).db);
  if (local) return local;
  const cached = api.catalog.get(id);
  try {
    const record = await api.client.getFilament(id);
    api.catalog.saveRecord(id, record, now);
    const entry = api.catalog.get(record.id);
    if (!entry) throw new Error(`filament ${record.id} wasn't saved`);
    return { entry, fetched: true, fromExport: false, ageDays: 0, stale: false, warning: null };
  } catch (err) {
    if (!cached?.record || !cached.recordAt) throw err;
    const copy = cached.recordAt.toISOString().slice(0, 10);
    const warning = `couldn't refresh ${filamentName(cached.filament)} (${errorMessage(err)}): using the copy from ${copy}`;
    return {
      entry: cached,
      fetched: false,
      fromExport: false,
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
