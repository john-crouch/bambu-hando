// ABOUTME: What `bambu-hando 3dfp import` and the TUI's Add tab share: the basis an import reads, a preview from the local
// ABOUTME: catalog (no API call), the preparation (catalog first, then the API, calls counted) and saving the new links.

import { FilamentCatalog } from "./filamentCatalog.js";
import { filamentRecord, localRecord } from "./filamentCatalogSync.js";
import { FilamentProfilesError, type TdfpSpool } from "./filamentProfiles.js";
import { forgetSpools, mySpools } from "./filamentProfilesCache.js";
import type { FilamentProfilesConnection } from "./filamentProfilesConnect.js";
import { type PresetSettings, settingsFromSpoolProfile } from "./presetSettings.js";
import { SpoolEaseClient, type SpoolEaseConnection, type SpoolRecord } from "./spoolease.js";
import { linksPath, loadLinks, type SpoolLink, saveLinks } from "./spoolLinks.js";
import { checkKey } from "./sync.js";
import {
  type AppliedImport,
  type ImportItem,
  type PreparedImport,
  prepareImport,
} from "./tdfpImport.js";

/** What an import starts from: the account's 3DFP spools, the links kept for this console, and its spools. */
export interface ImportBasis {
  tdfp: TdfpSpool[];
  /** The list came from the cache (under an hour old): no API call. */
  fromCache: boolean;
  links: SpoolLink[];
  /** The link file couldn't be read (it's set aside on the next save). */
  linkWarning: string | null;
  spoolease: SpoolRecord[];
}

/** Checks the console's key first (a wrong key reads as an empty list), then reads both sides and the links. */
export async function readImportBasis(
  api: FilamentProfilesConnection,
  target: SpoolEaseConnection,
  options: { refresh?: boolean } = {},
): Promise<ImportBasis> {
  const client = new SpoolEaseClient(target);
  await checkKey(client);
  const spoolease = await client.listSpools();
  const listed = await mySpools(api.client, {
    account: api.account,
    refresh: options.refresh ?? false,
  });
  const { links, warning } = await loadLinks(linksPath(), api.account, target.host);
  return {
    tdfp: listed.spools,
    fromCache: listed.fromCache,
    links,
    linkWarning: warning,
    spoolease,
  };
}

export interface ImportPreviewRow {
  spool: TdfpSpool;
  /**
   * What importing it writes, from the local catalog's record (the spool's own calibration isn't read yet); null
   * when it's refused or the catalog doesn't have its record (read when the import is prepared).
   */
  item: ImportItem | null;
  /** Why it isn't brought in; null when it can be. */
  refusal: string | null;
}

export interface ImportPreview {
  /** The account's spools not linked to this console yet, in the list's order. */
  rows: ImportPreviewRow[];
  /** How many are linked already. */
  linked: number;
}

class NotInCatalog extends Error {}

/** Each unlinked spool as prepareImport would see it, reading only the local catalog: never an API call. */
export async function previewImport(
  basis: ImportBasis,
  catalog: FilamentCatalog,
  now: Date,
): Promise<ImportPreview> {
  const linked = new Set(basis.links.map((link) => link.tdfp));
  const rows: ImportPreviewRow[] = [];
  for (const spool of basis.tdfp) {
    if (linked.has(spool.shortCode)) continue;
    try {
      const { items, refused } = await prepareImport({
        codes: [spool.shortCode],
        tdfp: basis.tdfp,
        links: basis.links,
        spoolease: basis.spoolease,
        record: async (id) => {
          const record = localRecord(catalog, id, now)?.entry.record;
          if (!record) throw new NotInCatalog();
          return record;
        },
        calibration: async () => ({}),
      });
      rows.push({ spool, item: items[0] ?? null, refusal: refused[0]?.reason ?? null });
    } catch (err) {
      if (!(err instanceof NotInCatalog)) throw err;
      rows.push({ spool, item: null, refusal: null });
    }
  }
  return { rows, linked: basis.tdfp.length - rows.length };
}

export interface PreparedFromApi {
  prepared: PreparedImport;
  /** API calls the preparation took (records missing from the catalog, calibrations). */
  calls: number;
  /** Records the catalog had but couldn't refresh. */
  warnings: string[];
}

/** prepareImport with the catalog's records first (fetching those it lacks) and each calibrated spool's own values. */
export async function prepareFromApi(
  api: FilamentProfilesConnection,
  basis: ImportBasis,
  codes: string[],
  options: { catalogPath?: string } = {},
): Promise<PreparedFromApi> {
  let calls = 0;
  const warnings: string[] = [];
  const catalog = FilamentCatalog.open(options.catalogPath);
  try {
    const prepared = await prepareImport({
      codes,
      tdfp: basis.tdfp,
      links: basis.links,
      spoolease: basis.spoolease,
      record: async (id) => {
        const found = await filamentRecord({ client: api.client, catalog, ledger: api.ledger }, id);
        if (found.fetched) calls += 1;
        if (found.warning) warnings.push(found.warning);
        if (!found.entry.record)
          throw new FilamentProfilesError(`3DFilamentProfiles has no record for filament #${id}`);
        return found.entry.record;
      },
      calibration: async (code): Promise<PresetSettings> => {
        calls += 1;
        return settingsFromSpoolProfile((await api.client.spoolProfile(code)).applied);
      },
    });
    return { prepared, calls, warnings };
  } finally {
    catalog.close();
  }
}

/**
 * Adds the import's links to the book as it is now (another run may have saved links since it was read), and
 * forgets the cached spool list once 3DFP was written to. Returns where an unreadable link file was set aside.
 */
export async function saveImportLinks(
  api: FilamentProfilesConnection,
  host: string,
  applied: Pick<AppliedImport, "links" | "calls">,
): Promise<string | null> {
  const { links } = await loadLinks(linksPath(), api.account, host);
  const codes = new Set(applied.links.map((link) => link.tdfp));
  const ids = new Set(applied.links.map((link) => link.spoolease));
  const kept = links.filter((link) => !codes.has(link.tdfp) && !ids.has(link.spoolease));
  const setAside = await saveLinks(linksPath(), api.account, host, [...kept, ...applied.links]);
  if (applied.calls > 0) await forgetSpools();
  return setAside;
}

/** The print settings a profile carries, as people read them: "print 245°C", "bed 65°C", "flow 0.95"… */
export function settingsParts(settings: PresetSettings | undefined): string[] {
  const s = settings ?? {};
  return [
    s.printTemp === undefined ? null : `print ${s.printTemp}°C`,
    s.bedTemp === undefined ? null : `bed ${s.bedTemp}°C`,
    s.flowRatio === undefined ? null : `flow ${s.flowRatio}`,
    s.maxVolumetricSpeed === undefined ? null : `max ${s.maxVolumetricSpeed} mm³/s`,
    s.pressureAdvance?.enabled ? `PA ${s.pressureAdvance.k}` : null,
  ].filter((part): part is string => part !== null);
}

/** "print 245°C · bed 65°C · flow 0.95 · max 11.5 mm³/s (3DFP's record)", or that Generic's are kept. */
export function importSettingsText(item: Pick<ImportItem, "profile" | "calibrated">): string {
  const parts = settingsParts(item.profile.settings);
  const from = item.calibrated ? "your calibration, then 3DFP's record" : "3DFP's record";
  return parts.length
    ? `${parts.join(" · ")} (${from})`
    : "Generic's print settings (3DFP has none)";
}
